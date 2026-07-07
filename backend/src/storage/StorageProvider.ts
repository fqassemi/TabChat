export interface StorageProvider {

    isTemporary(): boolean;

    getLocalPath(userId: string): Promise<string>;

    beforeLoad(userId: string): Promise<void>;

    afterSave(userId: string): Promise<void>;

    cleanup(userId: string): Promise<void>;

}