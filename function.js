// Firebase Core SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// Firebase Auth SDK (für die Benutzeranmeldung)
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// Firebase Firestore SDK (für die Datenbank)
import { 
    getFirestore, 
    doc, 
    runTransaction, 
    setLogLevel,
    collection,
    query,
    where,
    getDocs,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Konfiguration für Netlify ---
// DEINE FIREBASE-KONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyAVAF3jzjP8harkNYYgZmIhbIHn5TZmAP0",
  authDomain: "wichteln-603a8.firebaseapp.com",
  projectId: "wichteln-603a8",
  storageBucket: "wichteln-603a8.firebasestorage.app",
  messagingSenderId: "119876319727",
  appId: "1:119876319727:web:007e1aadbb1e7a59141e1a",
  measurementId: "G-89T75W5MTZ"
};
const appId = 'wichteln-603a8'; // Festgelegt für Netlify

// --- UI-Elemente ---
const loadingDiv = document.getElementById('loading');
const resultDiv = document.getElementById('result');
const errorDiv = document.getElementById('error');
const numberDisplay = document.getElementById('numberDisplay');
const errorMessage = document.getElementById('errorMessage');
const drawButton = document.getElementById('drawButton'); // Geändert
const initButton = document.getElementById('initButton');
const adminSection = document.getElementById('adminSection');

let db, auth;
let userId;
let initClickCount = 0; // Für Admin-Doppelklick-Bestätigung

// --- Datenbank-Pfade (NEUE SKALIERBARE STRUKTUR) ---
const NUMBERS_COLLECTION_REF = () => collection(db, 'wichtelNumbers');
const MAX_NUMBER = 63; // Maximale Anzahl an Nummern (1 bis 63)

/**
 * Hauptfunktion: Initialisiert Firebase und prüft den Status des Benutzers.
 */
async function main() {
    if (!firebaseConfig.apiKey) {
        showError("Firebase-Konfiguration fehlt. Die App kann nicht gestartet werden.");
        return;
    }

    try {
        // Firebase App initialisieren
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        // setLogLevel('debug'); // (Optional) Für Debugging

        // Persistenz auf "local" setzen
        await setPersistence(auth, browserLocalPersistence);

        // Benutzer-Authentifizierung (Vereinfacht für Netlify)
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // Benutzer ist angemeldet
                userId = user.uid;
                checkLocalStorage();
            } else {
                // Benutzer ist nicht angemeldet, anonym anmelden
                try {
                    await signInAnonymously(auth);
                } catch (err) {
                    console.error("Fehler bei signInAnonymously:", err);
                    showError("Anmeldung fehlgeschlagen. Bitte Seite neu laden.");
                }
            }
        });

        // Event Listeners für die Buttons
        drawButton.addEventListener('click', drawNumber); // Geändert
        initButton.addEventListener('click', initializeLottery);

    } catch (err) {
        console.error("Firebase-Initialisierungsfehler:", err);
        showError("Ein kritischer Fehler ist aufgetreten.");
    }
}

/**
 * Prüft, ob der Benutzer bereits eine Nummer im lokalen Speicher hat.
 */
function checkLocalStorage() {
    const storedNumber = localStorage.getItem(`wichtelNummer_${appId}`);
    if (storedNumber) {
        showResult(storedNumber); // Versteckt automatisch den Button
    } else {
        drawButton.classList.remove('hidden'); // Zeigt den Button
    }
}

/**
 * (NEU) Startet den Zieh-Vorgang (Skalierbare Sharding-Methode).
 */
async function drawNumber() {
    if (!db || !userId) {
        showError("Datenbank ist nicht verbunden oder Benutzer nicht angemeldet.");
        return;
    }
    setLoading(true);

    try {
        // 1. Finde ALLE freien Nummern (nur Lesezugriff, kein Hotspot)
        const numbersCollection = NUMBERS_COLLECTION_REF();
        const q = query(numbersCollection, where("drawn", "==", false));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error("Alle Nummern sind bereits vergeben!");
        }

        // 2. Mische die verfügbaren Dokumente lokal
        // Wichtig, damit nicht alle 63 User das gleiche Dokument probieren
        const availableDocs = querySnapshot.docs;
        availableDocs.sort(() => Math.random() - 0.5);

        let drawnNumber = null;

        // 3. Versuche, die Dokumente nacheinander zu "beanspruchen" (claim)
        for (const docSnap of availableDocs) {
            try {
                // Wir verwenden eine Transaktion, um *dieses eine Dokument* zu beanspruchen
                // Dies ist ein minimaler Schreibzugriff und erzeugt keinen Hotspot.
                await runTransaction(db, async (transaction) => {
                    const freshDoc = await transaction.get(docSnap.ref);
                    
                    if (freshDoc.data().drawn === true) {
                        // Jemand war schneller bei DIESER Nummer.
                        // Wir werfen einen Fehler, damit die Schleife die nächste Nr. probiert.
                        throw new Error("Nummer bereits vergeben, probiere nächste.");
                    }
                    
                    // Wir haben es! Wir beanspruchen diese Nummer.
                    transaction.update(docSnap.ref, { 
                        drawn: true, 
                        drawnBy: userId 
                    });
                    
                    drawnNumber = freshDoc.data().number;
                });

                // Wenn die Transaktion erfolgreich war, haben wir eine Nummer
                if (drawnNumber) {
                    break; // Verlasse die for-Schleife
                }

            } catch (transactionError) {
                // Diese Transaktion ist fehlgeschlagen (Kollision bei DIESER Nummer)
                // Das ist OK. Die Schleife wird automatisch die nächste versuchen.
                console.warn(`Kollision bei Nummer ${docSnap.id}, probiere nächste.`);
            }
        } // Ende der for-Schleife

        if (drawnNumber) {
            // Erfolg!
            setLoading(false);
            showResult(drawnNumber, true); // true für Animation
            localStorage.setItem(`wichtelNummer_${appId}`, drawnNumber);
        } else {
            // Sollte nur passieren, wenn alle Nummern vergeben sind,
            // während wir in der Schleife waren.
            throw new Error("Konnte keine freie Nummer finden (evtl. alle vergeben).");
        }

    } catch (err) {
        console.error("Fehler beim Ziehen:", err);
        setLoading(false);
        if (err.message.includes("Alle Nummern")) {
            showError("Leider zu spät! Alle Wichtel-Nummern wurden bereits gezogen.");
        } else {
            showError("Ein Fehler ist aufgetreten. Bitte versuche es erneut.");
        }
    }
}


/**
 * (NEU - Admin-Funktion) Initialisiert die Lotterie.
 * Erstellt 63 einzelne Dokumente.
 */
async function initializeLottery() {
    if (!db) {
        showError("Datenbank ist nicht verbunden.");
        return;
    }
    
    // Doppelklick-Bestätigung statt window.confirm()
    if (initClickCount === 0) {
        showError("Admin: Nochmal klicken, um die Lotterie unwiderruflich zurückzusetzen!");
        initClickCount++;
        // Timer, um den Klick-Zähler zurückzusetzen
        setTimeout(() => { initClickCount = 0; }, 3000);
        return;
    }
    
    // Zweiter Klick (Bestätigung)
    initClickCount = 0;
    setLoading(true);

    try {
        // (NEU) Wir verwenden einen Batch Write für Effizienz
        const batch = writeBatch(db);
        const numbersCollection = NUMBERS_COLLECTION_REF();

        // Erstellt 63 Dokumente (1 bis MAX_NUMBER)
        for (let i = 1; i <= MAX_NUMBER; i++) {
            const numDocRef = doc(numbersCollection, String(i)); // ID '1', '2', ...
            const data = {
                number: i,
                drawn: false,
                drawnBy: null
            };
            batch.set(numDocRef, data);
        }
        
        // (NEU) Führt alle Schreibvorgänge auf einmal aus
        await batch.commit();

        // Lokalen Speicher für diesen Benutzer löschen (falls vorhanden)
        localStorage.removeItem(`wichtelNummer_${appId}`);

        setLoading(false);
        // Erfolgsmeldung anzeigen, bevor neugeladen wird
        showError("Lotterie erfolgreich zurückgesetzt! Seite wird neu geladen...");
        setTimeout(() => {
            window.location.reload(); // Seite neu laden
        }, 2000);


    } catch (err) {
        console.error("Fehler beim Initialisieren:", err);
        setLoading(false);
        showError("Fehler beim Zurücksetzen der Lotterie.");
    }
}

// --- UI-Hilfsfunktionen ---

function setLoading(isLoading) {
    loadingDiv.classList.toggle('hidden', !isLoading);
    drawButton.classList.toggle('hidden', isLoading); // Button bei Laden ausblenden
    resultDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    if(isLoading) initClickCount = 0; // Zähler bei Ladevorgang zurücksetzen
}

function showResult(number, animate = false) {
    numberDisplay.textContent = number;
    if(animate) {
        resultDiv.classList.add('pop-out'); // Animation "popOutAndUp"
    }
    resultDiv.classList.remove('hidden');
    drawButton.classList.add('hidden'); // Button bei Ergebnis ausblenden
    loadingDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
}


function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    drawButton.classList.add('hidden'); // Button bei Fehler ausblenden
    loadingDiv.classList.add('hidden');
    resultDiv.classList.add('hidden');
    
    // Wenn es kein Admin-Reset-Fehler war, Button wieder anzeigen
    if (!message.startsWith("Admin:") && !message.includes("erfolgreich zurückgesetzt")) {
         setTimeout(() => {
             if (localStorage.getItem(`wichtelNummer_${appId}`) == null) {
                 drawButton.classList.remove('hidden'); // Button wieder anzeigen
                 errorDiv.classList.add('hidden');
             }
         }, 3000);
    }
}

// --- Admin Sektion per URL-Parameter einblenden ---
function checkAdminMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === '1') {
        if (adminSection) {
            adminSection.classList.remove('hidden');
        }
    }
}

// --- Schneefall-Animation (aus SCSS übersetzt) ---
function createSnowfall() {
    const snowContainer = document.getElementById('snow-container');
    if (!snowContainer) return;
    
    const total = 200;
    let styleSheet = document.createElement("style");
    document.head.appendChild(styleSheet);
    
    for (let i = 1; i <= total; i++) {
        // Zufällige Werte generieren
        const randomX = Math.random() * 100; // vw
        const randomOffset = (Math.random() * 200) - 100; // vw
        const randomXEnd = randomX + randomOffset;
        const randomXEndYoyo = randomX + (randomOffset / 2);
        const randomYoyoTime = (Math.random() * (0.8 - 0.3) + 0.3); // 30% bis 80% der Zeit
        const randomYoyoY = randomYoyoTime * 100; // vh
        const randomScale = Math.random();
        const fallDuration = (Math.random() * (30 - 10) + 10); // 10-30s
        const fallDelay = Math.random() * -30; // 0 bis -30s
        const opacity = Math.random();
        
        // Schneeflocken-Element erstellen
        let snowFlake = document.createElement('div');
        snowFlake.classList.add('snow');
        snowFlake.style.opacity = opacity;
        snowFlake.style.transform = `translate(${randomX}vw, -10px) scale(${randomScale})`;
        snowFlake.style.width = `${randomScale * 10}px`;
        snowFlake.style.height = `${randomScale * 10}px`;
        snowFlake.style.animation = `fall-${i} ${fallDuration}s ${fallDelay}s linear infinite`;
        
        snowContainer.appendChild(snowFlake);
        
        // Keyframe-Animation dynamisch erstellen
        const keyframeName = `fall-${i}`;
        const keyframeRule = `
            @keyframes ${keyframeName} {
                ${randomYoyoTime * 100}% {
                    transform: translate(${randomXEnd}vw, ${randomYoyoY}vh) scale(${randomScale});
                }
                to {
                    transform: translate(${randomXEndYoyo}vw, 100vh) scale(${randomScale});
                }
            }
        `;
        styleSheet.sheet.insertRule(keyframeRule, styleSheet.sheet.cssRules.length);
    }
}

// --- Start der Anwendung ---
checkAdminMode();
main();
createSnowfall(); // Schneefall starten

// WICHTIG: lucide.createIcons() muss aufgerufen werden, *nachdem* das HTML geladen wurde.
// Da dieses Skript am Ende des Body geladen wird, ist das HTML verfügbar.
// Wenn du das Skript in den <head> verschiebst, musst du 'defer' verwenden oder
// diesen Aufruf in ein 'DOMContentLoaded'-Event verpacken.
lucide.createIcons(); // Icons rendern (wichtig für das Geschenk-Icon)