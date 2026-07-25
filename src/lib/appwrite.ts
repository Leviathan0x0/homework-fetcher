import { Client, Account, Databases, Storage, Functions, Realtime } from "appwrite";

const metaEnv = (import.meta as any).env || {};
export const APPWRITE_ENDPOINT = metaEnv.VITE_APPWRITE_ENDPOINT || "https://sgp.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID = metaEnv.VITE_APPWRITE_PROJECT_ID || "6a637cb9000e2ff291cf";
export const APPWRITE_DATABASE_ID = metaEnv.VITE_APPWRITE_DATABASE_ID || "6a637d61002bd18d3cd5";
export const APPWRITE_BUCKET_ID = metaEnv.VITE_APPWRITE_BUCKET_ID || "classwork-files";

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const realtime = new Realtime(client);

export const COLLECTIONS = {
  USERS: "users",
  HOMEWORK: "homework",
  HOMEWORK_USER_STATE: "homework_user_state",
  CLASSWORK_UPLOADS: "classwork_uploads",
  SECTION_REQUESTS: "section_requests",
  NOTIFICATIONS: "notifications",
  CONVERSATIONS: "conversations",
  CONVERSATION_PARTICIPANTS: "conversation_participants",
  MESSAGES: "messages",
};
