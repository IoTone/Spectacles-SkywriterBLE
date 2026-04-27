// Copyright (c) 2026 IoTone, Inc. All rights reserved.
// Licensed under the MIT License. See LICENSE.md in the project root.

export interface JournalEntry {
    id: string
    createdAt: number
    updatedAt: number
    title: string
    content: string
}

export interface JournalStore {
    list(): JournalEntry[]
    load(id: string): JournalEntry | null
    save(entry: JournalEntry): void
    remove(id: string): void
    getCurrentId(): string | null
    setCurrentId(id: string): void
}
