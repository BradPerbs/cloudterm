/**
 * The sound of the assistant getting back to you: two soft notes, a fifth
 * apart, that go with its desktop notifications. Drawn with Web Audio rather
 * than shipped as a file, so there is nothing to bundle or load, and quiet
 * enough to sit under whatever else is playing.
 */

const NOTES = [
    { frequency: 880, at: 0 },
    { frequency: 1318.5, at: 0.11 },
];
const LENGTH = 0.42; // seconds each note rings for
const VOLUME = 0.12;

// One context for the window's life: browsers cap how many can be open.
let context = null;

export function playChime() {
    try {
        context = context || new AudioContext();
        // Suspended in a window that has not made a sound yet.
        if (context.state === 'suspended') context.resume().catch(() => {});

        const start = context.currentTime + 0.02;
        for (const note of NOTES) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = note.frequency;

            // A quick rise and a long fall, like a struck bell, so neither end
            // clicks.
            const at = start + note.at;
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(VOLUME, at + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH);

            oscillator.connect(gain).connect(context.destination);
            oscillator.start(at);
            oscillator.stop(at + LENGTH + 0.02);
        }
    } catch {
        // No audio device, or no Web Audio: the notification still says it.
    }
}
