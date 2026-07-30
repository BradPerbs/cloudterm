// Windows Hello, reachable from the app.
//
// Electron has no Hello API and there is no npm package for it that does not
// drag in a native build toolchain. This is the smallest thing that works: a
// console helper compiled by the csc.exe that ships with Windows, against the
// .winmd files in System32. No SDK, no node-gyp, no prebuilds. See
// scripts/build-hello-helper.js.
//
// PowerShell was tried first and cannot do this at all: it marshals WinRT
// IBuffer as a bare __ComObject and refuses to pass one either out of
// RequestSignAsync or back into it.
//
// No async/await either — those need the GetAwaiter extensions from
// System.Runtime.WindowsRuntime, which this compiler will not bind against the
// in-box facades. Waiting on the Completed handler is what await compiles to
// anyway, and it keeps this to winmd references alone.
//
// Commands, one line of `key=value` per answer on stdout:
//
//   supported              -> supported=True|False
//   create <name>          -> status=..., publicKey=<base64 SPKI>   (prompts)
//   publickey <name>       -> status=..., publicKey=<base64 SPKI>   (no prompt)
//   sign <name>            -> status=..., signature=<base64>        (prompts)
//                             the data to sign is read from stdin as base64
//   delete <name>          -> status=Deleted
//
// Exit code is 0 when the command did what it says, non-zero otherwise. The
// caller reads `status=` for the detail, because "the user cancelled" and "no
// such credential" are different things and only one of them is worth a retry.
using System;
using System.Threading;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;
using Windows.Security.Cryptography.Core;
using Windows.Storage.Streams;

static class HelloHelper
{
    // Long enough for someone to notice the prompt and find a finger.
    const int PromptTimeout = 120000;
    const int QuietTimeout = 20000;

    static T Wait<T>(IAsyncOperation<T> operation, int timeoutMs)
    {
        var done = new ManualResetEventSlim(false);
        operation.Completed = delegate { done.Set(); };
        if (!done.Wait(timeoutMs)) throw new TimeoutException("Windows Hello did not answer in time");
        return operation.GetResults();
    }

    static void WaitAction(IAsyncAction action, int timeoutMs)
    {
        var done = new ManualResetEventSlim(false);
        action.Completed = delegate { done.Set(); };
        if (!done.Wait(timeoutMs)) throw new TimeoutException("Windows Hello did not answer in time");
        action.GetResults();
    }

    static int Main(string[] args)
    {
        try
        {
            string command = args.Length > 0 ? args[0] : "supported";
            string name = args.Length > 1 ? args[1] : null;

            switch (command)
            {
                case "supported":
                    Console.WriteLine("supported=" + Wait(KeyCredentialManager.IsSupportedAsync(), QuietTimeout));
                    return 0;
                case "create":
                    return Retrieve(Wait(KeyCredentialManager.RequestCreateAsync(
                        name, KeyCredentialCreationOption.ReplaceExisting), PromptTimeout));
                case "publickey":
                    return Retrieve(Wait(KeyCredentialManager.OpenAsync(name), QuietTimeout));
                case "sign":
                    return Sign(name);
                case "delete":
                    WaitAction(KeyCredentialManager.DeleteAsync(name), QuietTimeout);
                    Console.WriteLine("status=Deleted");
                    return 0;
                default:
                    Console.WriteLine("status=UnknownCommand");
                    return 2;
            }
        }
        catch (Exception error)
        {
            // Unwrapped: a WinRT failure arrives inside an AggregateException and
            // the useful sentence is the inner one.
            while (error.InnerException != null) error = error.InnerException;
            Console.WriteLine("status=Error");
            Console.WriteLine("message=" + error.Message.Replace("\r", " ").Replace("\n", " "));
            return 1;
        }
    }

    /// <summary>The public half, as X.509 SubjectPublicKeyInfo — what node reads.</summary>
    static int Retrieve(KeyCredentialRetrievalResult result)
    {
        Console.WriteLine("status=" + result.Status);
        if (result.Status != KeyCredentialStatus.Success) return 1;

        byte[] publicKey;
        CryptographicBuffer.CopyToByteArray(
            result.Credential.RetrievePublicKey(CryptographicPublicKeyBlobType.X509SubjectPublicKeyInfo),
            out publicKey);
        Console.WriteLine("publicKey=" + Convert.ToBase64String(publicKey));
        return 0;
    }

    /// <summary>
    /// Sign what arrives on stdin. Read from there rather than the command line
    /// because an SSH authentication blob is not small and has no business
    /// being visible in the process list.
    /// </summary>
    static int Sign(string name)
    {
        var opened = Wait(KeyCredentialManager.OpenAsync(name), QuietTimeout);
        Console.WriteLine("status=" + opened.Status);
        if (opened.Status != KeyCredentialStatus.Success) return 1;

        byte[] data = Convert.FromBase64String(Console.In.ReadToEnd().Trim());
        var result = Wait(opened.Credential.RequestSignAsync(
            CryptographicBuffer.CreateFromByteArray(data)), PromptTimeout);

        Console.WriteLine("signStatus=" + result.Status);
        if (result.Status != KeyCredentialStatus.Success) return 1;

        byte[] signature;
        CryptographicBuffer.CopyToByteArray(result.Result, out signature);
        Console.WriteLine("signature=" + Convert.ToBase64String(signature));
        return 0;
    }
}
