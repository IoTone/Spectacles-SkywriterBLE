// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

import {JournalEntry, JournalStore} from "./JournalTypes"

const KEY_INDEX = "journal:index"
const KEY_CURRENT = "journal:currentId"
const KEY_ENTRY_PREFIX = "journal:entry:"

export class LocalJournalStore implements JournalStore {
    private store: GeneralDataStore

    constructor() {
        this.store = global.persistentStorageSystem.store
    }

    public list(): JournalEntry[] {
        const ids = this.readIndex()
        const out: JournalEntry[] = []
        for (const id of ids) {
            const e = this.load(id)
            if (e) out.push(e)
        }
        return out
    }

    public load(id: string): JournalEntry | null {
        const key = KEY_ENTRY_PREFIX + id
        if (!this.store.has(key)) return null
        try {
            const raw = this.store.getString(key)
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed.id !== "string") return null
            return parsed as JournalEntry
        } catch (e) {
            print("LocalJournalStore: failed to parse entry " + id + ": " + e)
            return null
        }
    }

    public save(entry: JournalEntry): void {
        const key = KEY_ENTRY_PREFIX + entry.id
        this.store.putString(key, JSON.stringify(entry))

        const ids = this.readIndex()
        if (ids.indexOf(entry.id) === -1) {
            ids.push(entry.id)
            // Numeric millis IDs sort newest-first
            ids.sort((a, b) => Number(b) - Number(a))
            this.writeIndex(ids)
        }
    }

    public remove(id: string): void {
        const key = KEY_ENTRY_PREFIX + id
        if (this.store.has(key)) this.store.remove(key)

        const ids = this.readIndex().filter((x) => x !== id)
        this.writeIndex(ids)

        if (this.getCurrentId() === id) {
            if (this.store.has(KEY_CURRENT)) this.store.remove(KEY_CURRENT)
        }
    }

    public getCurrentId(): string | null {
        if (!this.store.has(KEY_CURRENT)) return null
        const v = this.store.getString(KEY_CURRENT)
        return v && v.length > 0 ? v : null
    }

    public setCurrentId(id: string): void {
        this.store.putString(KEY_CURRENT, id)
    }

    private readIndex(): string[] {
        if (!this.store.has(KEY_INDEX)) return []
        try {
            const raw = this.store.getString(KEY_INDEX)
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
        } catch (e) {
            print("LocalJournalStore: failed to parse index: " + e)
            return []
        }
    }

    private writeIndex(ids: string[]): void {
        this.store.putString(KEY_INDEX, JSON.stringify(ids))
    }
}
