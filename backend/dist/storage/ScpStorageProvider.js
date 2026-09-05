import SftpClient from "ssh2-sftp-client";
import fs from "fs";
export class ScpStorageProvider {
    constructor(config) {
        this.tempBase = "./tmp/faiss";
        this.queue = Promise.resolve();
        this.config = config;
    }
    isTemporary() {
        return true;
    }
    withLock(fn) {
        const run = this.queue.then(fn, fn);
        this.queue = run.catch(() => { });
        return run;
    }
    async connect() {
        const sftp = new SftpClient();
        await sftp.connect({
            host: this.config.host,
            username: this.config.username,
            password: this.config.password,
        });
        return sftp;
    }
    async validate() {
        const sftp = await this.connect();
        try {
            const remotePath = this.config.remote_path;
            // 1) بررسی وجود remote path
            const exists = await sftp.exists(remotePath);
            if (!exists) {
                throw new Error(`Remote path does not exist: ${remotePath}`);
            }
            // 2) تست permission با ساخت فایل موقت
            const testFile = `${remotePath}/.chatgpt_sftp_test_${Date.now()}`;
            const testContent = "sftp permission test";
            try {
                await sftp.put(Buffer.from(testContent), testFile);
            }
            catch (err) {
                throw new Error("Permission denied: cannot write to remote path");
            }
            // 3) تست read
            try {
                await sftp.get(testFile);
            }
            catch (err) {
                throw new Error("Permission denied: cannot read from remote path");
            }
            // 4) پاک کردن فایل تست
            try {
                await sftp.delete(testFile);
            }
            catch (err) {
                throw new Error("Permission denied: cannot delete files in remote path");
            }
        }
        finally {
            await sftp.end();
        }
    }
    // پاک کردن نسخه‌ی لوکال - هم قبل از دانلود (safety net) هم بعد از اتمام عملیات استفاده می‌شه
    clearLocalTemp(userId) {
        const local = `${this.tempBase}/${userId}`;
        const metadataLocal = `${this.tempBase}/${userId}-metadata.json`;
        const tabsLocal = `${this.tempBase}/${userId}-tabs.json`;
        const pendingLocal = `${this.tempBase}/${userId}-pending.json`;
        if (fs.existsSync(pendingLocal)) {
            fs.rmSync(pendingLocal);
        }
        if (fs.existsSync(local)) {
            fs.rmSync(local, { recursive: true, force: true });
        }
        if (fs.existsSync(metadataLocal)) {
            fs.rmSync(metadataLocal);
        }
        if (fs.existsSync(tabsLocal)) {
            fs.rmSync(tabsLocal);
        }
    }
    async beforeLoad(userId) {
        return this.withLock(() => this._beforeLoad(userId));
    }
    async _beforeLoad(userId) {
        this.clearLocalTemp(userId);
        fs.mkdirSync(this.tempBase, { recursive: true });
        const local = `${this.tempBase}/${userId}`;
        fs.mkdirSync(local, { recursive: true });
        const sftp = await this.connect();
        const remote = `${this.config.remote_path}/${userId}`;
        const exists = await sftp.exists(remote);
        if (exists) {
            await sftp.downloadDir(remote, local);
            const metadataRemote = `${this.config.remote_path}/${userId}-metadata.json`;
            const metadataLocal = `${this.tempBase}/${userId}-metadata.json`;
            if (await sftp.exists(metadataRemote)) {
                await sftp.fastGet(metadataRemote, metadataLocal);
            }
            const tabsRemote = `${this.config.remote_path}/${userId}-tabs.json`;
            const tabsLocal = `${this.tempBase}/${userId}-tabs.json`;
            const pendingRemote = `${this.config.remote_path}/${userId}-pending.json`;
            const pendingLocal = `${this.tempBase}/${userId}-pending.json`;
            if (await sftp.exists(pendingRemote)) {
                await sftp.fastGet(pendingRemote, pendingLocal);
            }
            if (await sftp.exists(tabsRemote)) {
                await sftp.fastGet(tabsRemote, tabsLocal);
            }
        }
        await sftp.end();
        // دیگه بعد این هیچ rmSync‌ای نیست
    }
    async afterSave(userId) {
        return this.withLock(() => this._afterSave(userId));
    }
    async _afterSave(userId) {
        const sftp = await this.connect();
        const localBase = this.tempBase;
        const remoteBase = `${this.config.remote_path}`;
        await sftp.mkdir(`${remoteBase}/${userId}`, true);
        const faissDir = `${localBase}/${userId}`;
        await sftp.delete(`${remoteBase}/${userId}-tabs.json`).catch(() => { });
        await sftp.delete(`${remoteBase}/${userId}-metadata.json`).catch(() => { });
        // FAISS folder
        if (fs.existsSync(faissDir)) {
            await sftp.uploadDir(faissDir, `${remoteBase}/${userId}`);
        }
        // metadata
        const metadataFile = `${localBase}/${userId}-metadata.json`;
        if (fs.existsSync(metadataFile)) {
            await sftp.put(metadataFile, `${remoteBase}/${userId}-metadata.json`);
        }
        // tabs
        const tabsFile = `${localBase}/${userId}-tabs.json`;
        const pendingFile = `${localBase}/${userId}-pending.json`;
        if (fs.existsSync(pendingFile)) {
            await sftp.put(pendingFile, `${remoteBase}/${userId}-pending.json`);
        }
        else {
            await sftp.delete(`${remoteBase}/${userId}-pending.json`).catch(() => { });
        }
        if (fs.existsSync(tabsFile)) {
            await sftp.put(tabsFile, `${remoteBase}/${userId}-tabs.json`);
        }
        await sftp.end();
    }
    async getLocalPath(userId) {
        return `${this.tempBase}/${userId}`;
    }
    async cleanup(userId) {
        this.clearLocalTemp(userId);
    }
}
//# sourceMappingURL=ScpStorageProvider.js.map