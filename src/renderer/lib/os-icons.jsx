// Shared OS/distro iconography, used by both the host cards and the tab bar.

import iconAlma from '../assets/icons/128_alma_darkblue.png';
import iconAlpine from '../assets/icons/128_alpine.png';
import iconArch from '../assets/icons/128_arch.png';
import iconArco from '../assets/icons/128_arco.png';
import iconArtix from '../assets/icons/128_artix.png';
import iconCentos from '../assets/icons/128_centos_blue.png';
import iconDebian from '../assets/icons/128_debian.png';
import iconDeepin from '../assets/icons/128_deepin.png';
import iconElementary from '../assets/icons/128_elementary.png';
import iconEndeavour from '../assets/icons/128_endeavour.png';
import iconFedora from '../assets/icons/128_fedora_newlogo.png';
import iconGentoo from '../assets/icons/128_gentoo.png';
import iconKali from '../assets/icons/128_kali.png';
import iconKubuntu from '../assets/icons/128_kubuntu.png';
import iconLinux from '../assets/icons/128_linux.png';
import iconLubuntu from '../assets/icons/128_lubuntu.png';
import iconManjaro from '../assets/icons/128_manjaro.png';
import iconMint from '../assets/icons/128_mint.png';
import iconMx from '../assets/icons/128_mx.png';
import iconNixos from '../assets/icons/128_nixos.png';
import iconPop from '../assets/icons/128_pop.png';
import iconRaspios from '../assets/icons/128_raspios.png';
import iconRedhat from '../assets/icons/128_redhat.png';
import iconRocky from '../assets/icons/128_alma_red.png';
import iconSlackware from '../assets/icons/128_slackware.png';
import iconSolus from '../assets/icons/128_solus.png';
import iconSuse from '../assets/icons/128_suse.png';
import iconUbuntu from '../assets/icons/128_ubuntu.png';
import iconVoid from '../assets/icons/128_void.png';
import iconWindows from '../assets/icons/128_windows.png';
import iconXubuntu from '../assets/icons/128_xubuntu.png';
import iconZorin from '../assets/icons/128_zorin.png';
import iconParrot from '../assets/icons/128_parrot.png';
import iconGaruda from '../assets/icons/128_garuda_blue.png';
import iconTails from '../assets/icons/128_tails.png';

const ICON_MAP = {
    // Distros
    ubuntu: iconUbuntu,
    kubuntu: iconKubuntu,
    lubuntu: iconLubuntu,
    xubuntu: iconXubuntu,
    debian: iconDebian,
    fedora: iconFedora,
    centos: iconCentos,
    rhel: iconRedhat,
    rocky: iconRocky,
    alma: iconAlma,
    arch: iconArch,
    arco: iconArco,
    artix: iconArtix,
    manjaro: iconManjaro,
    endeavour: iconEndeavour,
    garuda: iconGaruda,
    alpine: iconAlpine,
    nixos: iconNixos,
    gentoo: iconGentoo,
    suse: iconSuse,
    opensuse: iconSuse,
    mint: iconMint,
    pop: iconPop,
    elementary: iconElementary,
    zorin: iconZorin,
    deepin: iconDeepin,
    kali: iconKali,
    parrot: iconParrot,
    tails: iconTails,
    mx: iconMx,
    void: iconVoid,
    solus: iconSolus,
    slackware: iconSlackware,
    raspios: iconRaspios,
    raspberry: iconRaspios,
    // OS-level
    linux: iconLinux,
    windows: iconWindows,
};

export function getOsIcon(os, distro) {
    if (distro && ICON_MAP[distro]) return ICON_MAP[distro];
    if (os && ICON_MAP[os]) return ICON_MAP[os];
    return null;
}

/**
 * Which OS to draw a host as.
 *
 * `host.os` is whatever the SSH session reported, and it wins wherever it
 * exists. RDP is the case that never gets one: detection runs a command over an
 * SSH exec channel, a desktop-only host never dials SSH at all, and so those
 * cards sat on the generic fallback icon for the rest of their lives, before
 * and after connecting alike.
 *
 * RDP is a Windows protocol, so an RDP host is a Windows host until something
 * says otherwise, and it is worth saying so from the moment it is saved. A
 * detected OS still overrides this, which covers the Linux box running xrdp.
 * VNC gets no such default: it is as likely to be a Mac or a Pi.
 */
export function hostOs(host) {
    if (host?.os) return host.os;
    if (host?.desktop?.enabled && host.desktop.protocol === 'rdp') return 'windows';
    return '';
}

// macOS has no PNG in the icon set.
function MacOsIcon({ className }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
    );
}

// Shown until the remote OS has been detected, or when it is unrecognised.
function FallbackIcon({ className }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 8l4 4-4 4" />
            <path d="M13 16h4" />
        </svg>
    );
}

export function OsIcon({ os, distro, className = 'w-7 h-7' }) {
    const src = getOsIcon(os, distro);

    if (src) {
        return <img src={src} alt="" className={`${className} object-contain`} draggable={false} />;
    }
    if (os === 'macos') {
        return <MacOsIcon className={`${className} text-gray-500 dark:text-neutral-400`} />;
    }
    return <FallbackIcon className={`${className} text-gray-400 dark:text-neutral-500`} />;
}
