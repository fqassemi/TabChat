import { getUserStorage } from "../repositories/storage.ts";
import { LocalStorageProvider } from "./LocalStorageProvider.ts";
import { ScpStorageProvider } from "./ScpStorageProvider.ts";

export async function getStorageProvider(userId:string){

    const config = await getUserStorage(userId);


    switch(config.type){

        case "scp":
            return new ScpStorageProvider({
                host: config.host,
                username: config.username,
                password: config.password,
                remote_path: config.remote_path,
            });


        case "local":
        default:
            return new LocalStorageProvider();

    }

}