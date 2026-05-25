import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBdASpzHHqibx70UwzDOwjsHZLS8vf7-ec',
  authDomain: 'esmodeo-playground.firebaseapp.com',
  projectId: 'esmodeo-playground',
  storageBucket: 'esmodeo-playground.firebasestorage.app',
  messagingSenderId: '199662247161',
  appId: '1:199662247161:web:ade2eeb0c1cbc9c30cd628',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
