import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.projectId && firebaseConfig.apiKey
);

let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;

function getAppInstance(): FirebaseApp {
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

// Firestore con cache local persistente (IndexedDB) en el navegador.
// En el servidor (SSR) usa cache en memoria para evitar tocar IndexedDB.
export function getDb(): Firestore {
  if (_db) return _db;
  const a = getAppInstance();
  _db =
    typeof window !== "undefined"
      ? initializeFirestore(a, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        })
      : initializeFirestore(a, {});
  return _db;
}

export function getAuthInstance(): Auth {
  if (!_auth) _auth = getAuth(getAppInstance());
  return _auth;
}
