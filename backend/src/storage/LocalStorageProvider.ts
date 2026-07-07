import type { StorageProvider } from "./StorageProvider.ts";


export class LocalStorageProvider implements StorageProvider {

    isTemporary() {
        return false;
    }

    async getLocalPath(userId: string) {
        return `./data/faiss/${userId}`;
    }

    async beforeLoad(userId: string) {
    }

    async afterSave(userId: string) {
    }

    async cleanup(userId: string) {
        // برای local چیزی پاک نمی‌شه؛ اینجا دیتا دائمیه
    }

}