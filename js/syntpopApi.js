import { proxyFetch } from "./api.js";

const BASE_ADDRESS = "https://api.syntpop.nhn.no/";

let API_KEY;

export function setApiKey(key) {
    console.log("Setting API key:", key);
    API_KEY = key;
}

export function getApiKey() {
    console.log("Getting API key:", API_KEY);
    return API_KEY;
}

export function hasApiKey() {
    return !!API_KEY || API_KEY !== "";
}

export async function getByName(name) {
    let response = await proxyFetch(`${BASE_ADDRESS}api/search?page=0&pageSize=50`, {
        method: "POST",
        headers: {
            "X-api-key": `${API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "search": name,
        }),
    });

    console.log(response);  

    return response;
}
