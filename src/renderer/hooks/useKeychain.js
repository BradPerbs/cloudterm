import { useState, useCallback } from 'react';

export function useKeychain() {
    const [keys, setKeys] = useState([]);

    const loadData = useCallback(async () => {
        try {
            setKeys(await window.api.keys.list());
        } catch (error) {
            console.error('Failed to load keys:', error);
        }
    }, []);

    const saveKey = useCallback(async (key) => {
        const saved = await window.api.keys.save(key);
        await loadData();
        return saved;
    }, [loadData]);

    const deleteKey = useCallback(async (keyId) => {
        await window.api.keys.remove(keyId);
        await loadData();
    }, [loadData]);

    const generateKey = useCallback(async ({ type, keySize, comment, passphrase }) =>
        window.api.keys.generate({ type, keySize, comment, passphrase }), []);

    return {
        keys,
        loadData,
        saveKey,
        deleteKey,
        generateKey,
    };
}
