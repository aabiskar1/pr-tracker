// Investigation-only boundary: no browser storage, encryption or GitHub traffic.
import type { AppData, AppDataMutation } from '../../../src/types';
import { applyGroupingMutation } from '../../../src/utils/groupingPreferences';
import { appData } from '../../../tests/e2e/fixtures';

export let snapshot: AppData = appData([]);
export function setSnapshot(data: AppData) {
    snapshot = data;
}
export async function decryptAppData() {
    return structuredClone(snapshot);
}
export async function decryptHiddenPrIds() {
    return [];
}

const listeners = new Set<(changes: object) => void>();
const event = { addListener() {}, removeListener() {} };
const browser = {
    runtime: {
        getURL(value: string) {
            return new URL(value, location.href).href;
        },
        onMessage: event,
        async sendMessage(message: {
            type: string;
            mutation: AppDataMutation;
        }) {
            if (message.type !== 'UPDATE_APP_DATA') return true;
            const mutation = message.mutation;
            const preferences = snapshot.preferences!;
            if (
                mutation.kind === 'set-grouping-mode' ||
                mutation.kind === 'set-repositories-collapsed'
            ) {
                preferences.grouping = applyGroupingMutation(
                    preferences.grouping!,
                    mutation
                );
            } else if (mutation.kind === 'set-filters')
                preferences.filters = mutation.filters;
            else if (mutation.kind === 'set-sort')
                preferences.sort = mutation.sort;
            else throw new Error(`Unmeasured mutation: ${mutation.kind}`);
            for (const listener of listeners)
                listener({ encryptedAppData: {} });
            return true;
        },
    },
    storage: {
        onChanged: {
            addListener(listener: (changes: object) => void) {
                listeners.add(listener);
            },
            removeListener(listener: (changes: object) => void) {
                listeners.delete(listener);
            },
        },
        local: {
            async get() {
                return {};
            },
            async set() {},
        },
    },
};
export default browser;
