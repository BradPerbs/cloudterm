import { useState, useCallback } from 'react';

export function useSessions() {
    const [hosts, setHosts] = useState([]);
    const [folders, setFolders] = useState([]);

    const loadData = useCallback(async () => {
        try {
            const [hostList, folderList] = await Promise.all([
                window.api.hosts.list(),
                window.api.folders.list(),
            ]);
            setHosts(hostList);
            setFolders(folderList);
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }, []);

    const saveHost = useCallback(async (host) => {
        const saved = await window.api.hosts.save(host);
        await loadData();
        return saved;
    }, [loadData]);

    const deleteHost = useCallback(async (hostId) => {
        await window.api.hosts.remove(hostId);
        await loadData();
    }, [loadData]);

    const duplicateHost = useCallback(async (hostId) => {
        const copy = await window.api.hosts.duplicate(hostId);
        await loadData();
        return copy;
    }, [loadData]);

    const saveFolder = useCallback(async (folder) => {
        const saved = await window.api.folders.save(folder);
        await loadData();
        return saved;
    }, [loadData]);

    const deleteFolder = useCallback(async (folderId) => {
        await window.api.folders.remove(folderId);
        await loadData();
    }, [loadData]);

    /**
     * Delete a selection: `{ hostIds, folderIds }`.
     *
     * One reload at the end rather than one per record, because reloading
     * between deletes would redraw the page around a list that is still being
     * taken apart. Hosts go first: deleting a folder moves what is inside it up
     * a level, and a host that is on both lists should not have to survive that
     * trip only to be deleted from somewhere else.
     */
    const deleteMany = useCallback(async ({ hostIds = [], folderIds = [] } = {}) => {
        for (const hostId of hostIds) await window.api.hosts.remove(hostId);
        for (const folderId of folderIds) await window.api.folders.remove(folderId);
        await loadData();
    }, [loadData]);

    /**
     * Persist a rearrangement: `{ hosts: [{ id, folderId?, order? }], folders:
     * [{ id, parentId?, order? }] }`. One call however many cards moved, so a
     * reorder is a single write and a single reload rather than one per card.
     */
    const arrangeItems = useCallback(async (changes) => {
        await window.api.arrange.apply(changes);
        await loadData();
    }, [loadData]);

    /**
     * Add and remove tags across several hosts: `{ hostIds, add, remove }`.
     *
     * One call for the whole selection, for the same reason as `arrangeItems`:
     * a save per host would be a write per host, and a failure halfway would
     * leave the selection tagged in part. What comes back says how many records
     * actually changed, which is not the same as how many were asked for — a
     * host that already carries the tag is not an edit.
     */
    const tagHosts = useCallback(async (edit) => {
        const result = await window.api.hosts.tag(edit);
        await loadData();
        return result;
    }, [loadData]);

    return {
        hosts,
        folders,
        loadData,
        saveHost,
        deleteHost,
        duplicateHost,
        saveFolder,
        deleteFolder,
        deleteMany,
        arrangeItems,
        tagHosts,
    };
}
