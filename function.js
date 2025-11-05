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
const initButton = document.getElementById('initButton');
const adminSection = document.getElementById('adminSection');
// NEUE UI-Elemente
const genderSelectionDiv = document.getElementById('genderSelection');
const drawMaleButton = document.getElementById('drawMaleButton');
const drawFemaleButton = document.getElementById('drawFemaleButton');
const resultIntroText = document.getElementById('resultIntroText'); // NEU

let db, auth;
let userId;
let initClickCount = 0; // Für Admin-Doppelklick-Bestätigung

// --- Datenbank-Pfade (NEUE SKALIERBARE STRUKTUR) ---
// GETRENNTE POOLS
const MAX_NUMBER_MALE = 22;
const MAX_NUMBER_FEMALE = 31;
const NUMBERS_COLLECTION_REF_MALE = () => collection(db, 'wichtelNumbers_male');
const NUMBERS_COLLECTION_REF_FEMALE = () => collection(db, 'wichtelNumbers_female');


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
        // GEÄNDERT: Listener für die neuen Buttons
        drawMaleButton.addEventListener('click', () => drawNumber('male'));
        drawFemaleButton.addEventListener('click', () => drawNumber('female'));
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
    // GEÄNDERT: Wir speichern jetzt ein Objekt statt nur die Nummer
    const storedDataRaw = localStorage.getItem(`wichtelNummer_${appId}`);
    if (storedDataRaw) {
        try {
            const storedData = JSON.parse(storedDataRaw);
            if (storedData.number && storedData.gender) {
                showResult(storedData.number, false, storedData.gender); // Versteckt automatisch die Buttons
            } else {
                // Alter oder ungültiger Speicher, löschen und Auswahl anzeigen
                localStorage.removeItem(`wichtelNummer_${appId}`);
                genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
            }
        } catch (e) {
            // Fehler beim Parsen, löschen und Auswahl anzeigen
            localStorage.removeItem(`wichtelNummer_${appId}`);
            genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
        }
    } else {
        genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
    }
}

/**
 * (NEU) Startet den Zieh-Vorgang (Skalierbare Sharding-Methode).
 * @param {'male' | 'female'} gender Das ausgewählte Geschlecht
 */
async function drawNumber(gender) {
    if (!db || !userId) {
        showError("Datenbank ist nicht verbunden oder Benutzer nicht angemeldet.");
        return;
    }
    if (!gender) {
        showError("Fehler: Kein Geschlecht ausgewählt.");
        return;
    }

    setLoading(true);

    // Wähle die richtige Sammlung und Text basierend auf dem Geschlecht
    const numbersCollection = (gender === 'male') 
        ? NUMBERS_COLLECTION_REF_MALE() 
        : NUMBERS_COLLECTION_REF_FEMALE();
    
    const genderText = (gender === 'male') ? "Jungs" : "Mädels";

    try {
        // 1. Finde ALLE freien Nummern (nur Lesezugriff, kein Hotspot)
        const q = query(numbersCollection, where("drawn", "==", false));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error(`Alle Nummern für ${genderText} sind bereits vergeben!`);
        }

        // 2. Mische die verfügbaren Dokumente lokal
        const availableDocs = querySnapshot.docs;
        availableDocs.sort(() => Math.random() - 0.5);

        let drawnNumber = null;

        // 3. Versuche, die Dokumente nacheinander zu "beanspruchen" (claim)
        for (const docSnap of availableDocs) {
            try {
                // Wir verwenden eine Transaktion, um *dieses eine Dokument* zu beanspruchen
                await runTransaction(db, async (transaction) => {
                    const freshDoc = await transaction.get(docSnap.ref);
                    
                    if (freshDoc.data().drawn === true) {
                        throw new Error("Nummer bereits vergeben, probiere nächste.");
                    }
                    
                    // Wir haben es! Wir beanspruchen diese Nummer.
                    transaction.update(docSnap.ref, { 
                        drawn: true, 
                        drawnBy: userId 
                    });
                    
                    drawnNumber = freshDoc.data().number;
                });

                if (drawnNumber) {
                    break; // Verlasse die for-Schleife
                }

            } catch (transactionError) {
                console.warn(`Kollision bei Nummer ${docSnap.id} (Gruppe: ${gender}), probiere nächste.`);
            }
        } // Ende der for-Schleife

        if (drawnNumber) {
            // Erfolg!
            setLoading(false);
            showResult(drawnNumber, true, gender); // true für Animation, Geschlecht übergeben
            
            // GEÄNDERT: Speichere Objekt mit Nummer UND Geschlecht
            const dataToStore = { number: drawnNumber, gender: gender };
            localStorage.setItem(`wichtelNummer_${appId}`, JSON.stringify(dataToStore));

        } else {
            throw new Error("Konnte keine freie Nummer finden (evtl. alle vergeben).");
        }

    } catch (err) {
        console.error("Fehler beim Ziehen:", err);
        setLoading(false);
        if (err.message.includes("Alle Nummern")) {
            showError(`Leider zu spät! ${err.message}`);
        } else {
            showError("Ein Fehler ist aufgetreten. Bitte versuche es erneut.");
        }
    }
}


/**
 * (NEU - Admin-Funktion) Initialisiert die Lotterie.
 * Erstellt 22 (m) + 31 (w) einzelne Dokumente in getrennten Sammlungen.
 */
async function initializeLottery() {
    if (!db) {
        showError("Datenbank ist nicht verbunden.");
        return;
    }
    
    // Doppelklick-Bestätigung
    if (initClickCount === 0) {
        showError("Admin: Nochmal klicken, um die Lotterie (M+W) unwiderruflich zurückzusetzen!");
        initClickCount++;
        setTimeout(() => { initClickCount = 0; }, 3000);
        return;
    }
    
    initClickCount = 0;
    setLoading(true);

    try {
        // --- BATCH 1: MÄNNLICH (22) ---
        const batchMale = writeBatch(db);
        const numbersCollectionMale = NUMBERS_COLLECTION_REF_MALE();
        for (let i = 1; i <= MAX_NUMBER_MALE; i++) {
            const numDocRef = doc(numbersCollectionMale, String(i)); // ID '1', '2', ...
            batchMale.set(numDocRef, { number: i, drawn: false, drawnBy: null });
        }
        
        // --- BATCH 2: WEIBLICH (31) ---
        const batchFemale = writeBatch(db);
        const numbersCollectionFemale = NUMBERS_COLLECTION_REF_FEMALE();
        for (let i = 1; i <= MAX_NUMBER_FEMALE; i++) {
            const numDocRef = doc(numbersCollectionFemale, String(i)); // ID '1', '2', ...
            batchFemale.set(numDocRef, { number: i, drawn: false, drawnBy: null });
        }

        // Führe beide Batches aus
        await batchMale.commit();
        await batchFemale.commit();

        // Lokalen Speicher für diesen Benutzer löschen (falls vorhanden)
        localStorage.removeItem(`wichtelNummer_${appId}`);

        setLoading(false);
        // Erfolgsmeldung anzeigen, bevor neugeladen wird
        showError("Lotterie (Männlich & Weiblich) erfolgreich zurückgesetzt! Seite wird neu geladen...");
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
    genderSelectionDiv.classList.toggle('hidden', isLoading); // Auswahl bei Laden ausblenden
    resultDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    if(isLoading) initClickCount = 0; // Zähler bei Ladevorgang zurücksetzen
}

/**
 * Zeigt das Ergebnis an.
 * @param {string | number} number Die gezogene Nummer
 * @param {boolean} [animate=false] Ob animiert werden soll
 * @param {'male' | 'female'} [gender] Das Geschlecht für den Text
 */
function showResult(number, animate = false, gender) {
    numberDisplay.textContent = number;
    
    // NEU: Passe den Text basierend auf dem Geschlecht an
    if (gender) {
        const genderText = (gender === 'male') ? "Jungs" : "Mädels";
        resultIntroText.textContent = `Deine gezogene Wichtel-Nummer (Gruppe: ${genderText}) ist:`;
    } else {
        resultIntroText.textContent = `Deine gezogene Wichtel-Nummer ist:`;
    }

    if(animate) {
        resultDiv.classList.add('pop-out'); // Animation "popOutAndUp"
    }
    resultDiv.classList.remove('hidden');
    genderSelectionDiv.classList.add('hidden'); // Auswahl bei Ergebnis ausblenden
    loadingDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
}


function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    genderSelectionDiv.classList.add('hidden'); // Auswahl bei Fehler ausblenden
    loadingDiv.classList.add('hidden');
    resultDiv.classList.add('hidden');
    
    // Wenn es kein Admin-Reset-Fehler war, Auswahl wieder anzeigen
    if (!message.startsWith("Admin:") && !message.includes("erfolgreich zurückgesetzt")) {
         setTimeout(() => {
             // Prüfe, ob schon gezogen wurde. Nur wenn nicht, zeige Auswahl.
             if (localStorage.getItem(`wichtelNummer_${appId}`) == null) {
                 genderSelectionDiv.classList.remove('hidden'); // Auswahl wieder anzeigen
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
lucide.createIcons(); // Icons rendern (wichtig für das Geschenk-Icon)