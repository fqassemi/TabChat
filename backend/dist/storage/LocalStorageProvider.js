export class LocalStorageProvider {
    isTemporary() {
        return false;
    }
    async getLocalPath(userId) {
        return `./data/faiss/${userId}`;
    }
    async beforeLoad(userId) {
    }
    async afterSave(userId) {
    }
    async cleanup(userId) {
        // برای local چیزی پاک نمی‌شه؛ اینجا دیتا دائمیه
    }
}
//# sourceMappingURL=LocalStorageProvider.js.map