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

// --- Konfiguration (Platzhalter - wird von Netlify/Umgebung bereitgestellt) ---
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
const genderSelectionDiv = document.getElementById('genderSelection');
const resultIntroText = document.getElementById('resultIntroText'); 

let db, auth;
let userId;
let initClickCount = 0; // Für Admin-Doppelklick-Bestätigung
let selectedGender = null; // NEU: Status für ausgewähltes Geschlecht

// --- Datenbank-Pfade (unverändert) ---
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

        // Benutzer-Authentifizierung
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

        // --- NEU: Event Listeners für neuen UI-Flow ---
        
        // 1. UI-Elemente für den neuen Flow holen
        const btnMale = document.getElementById('btn-male');
        const btnFemale = document.getElementById('btn-female');
        const drawButtonContainer = document.getElementById('drawButtonContainer');
        const drawNumberButton = document.getElementById('drawNumberButton');

        // 2. Listener für Geschlechts-Auswahl (Männlich)
        btnMale.addEventListener('click', () => {
            selectedGender = 'male';
            btnMale.classList.add('active');
            btnFemale.classList.remove('active');
            drawButtonContainer.classList.remove('hidden'); // Zeige Zieh-Button
        });

        // 3. Listener für Geschlechts-Auswahl (Weiblich)
        btnFemale.addEventListener('click', () => {
            selectedGender = 'female';
            btnFemale.classList.add('active');
            btnMale.classList.remove('active');
            drawButtonContainer.classList.remove('hidden'); // Zeige Zieh-Button
        });

        // 4. Listener für den "Nummer ziehen"-Button
        drawNumberButton.addEventListener('click', () => {
            if (selectedGender) {
                // Ruft die bestehende Logik mit dem ausgewählten Geschlecht auf
                drawNumber(selectedGender); 
            } else {
                // Sollte nicht passieren, aber sicher ist sicher
                showError("Bitte wähle zuerst ein Geschlecht aus.");
            }
        });

        // 5. Admin-Button-Listener (unverändert)
        initButton.addEventListener('click', initializeLottery);

    } catch (err) {
        console.error("Firebase-Initialisierungsfehler:", err);
        showError("Ein kritischer Fehler ist aufgetreten.");
    }
}

/**
 * Prüft, ob der Benutzer bereits eine Nummer im lokalen Speicher hat.
 * (Logik unverändert, steuert nur Sichtbarkeit von #genderSelection)
 */
function checkLocalStorage() {
    const storedDataRaw = localStorage.getItem(`wichtelNummer_${appId}`);
    if (storedDataRaw) {
        try {
            const storedData = JSON.parse(storedDataRaw);
            if (storedData.number && storedData.gender) {
                showResult(storedData.number, false, storedData.gender); // Versteckt automatisch die Buttons
            } else {
                localStorage.removeItem(`wichtelNummer_${appId}`);
                genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
            }
        } catch (e) {
            localStorage.removeItem(`wichtelNummer_${appId}`);
            genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
        }
    } else {
        genderSelectionDiv.classList.remove('hidden'); // Zeigt Geschlechts-Auswahl
    }
}

/**
 * Startet den Zieh-Vorgang (Skalierbare Sharding-Methode).
 * (Funktion ist unverändert, wird jetzt nur vom neuen Button aufgerufen)
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

    const numbersCollection = (gender === 'male') 
        ? NUMBERS_COLLECTION_REF_MALE() 
        : NUMBERS_COLLECTION_REF_FEMALE();
    
    const genderText = (gender === 'male') ? "Jungs" : "Mädels";

    try {
        // 1. Finde ALLE freien Nummern
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
                await runTransaction(db, async (transaction) => {
                    const freshDoc = await transaction.get(docSnap.ref);
                    
                    if (freshDoc.data().drawn === true) {
                        throw new Error("Nummer bereits vergeben, probiere nächste.");
                    }
                    
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
            showResult(drawnNumber, true, gender);
            
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
 * (Admin-Funktion) Initialisiert die Lotterie.
 * (Funktion unverändert)
 */
async function initializeLottery() {
    if (!db) {
        showError("Datenbank ist nicht verbunden.");
        return;
    }
    
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
            const numDocRef = doc(numbersCollectionMale, String(i));
            batchMale.set(numDocRef, { number: i, drawn: false, drawnBy: null });
        }
        
        // --- BATCH 2: WEIBLICH (31) ---
        const batchFemale = writeBatch(db);
        const numbersCollectionFemale = NUMBERS_COLLECTION_REF_FEMALE();
        for (let i = 1; i <= MAX_NUMBER_FEMALE; i++) {
            const numDocRef = doc(numbersCollectionFemale, String(i));
            batchFemale.set(numDocRef, { number: i, drawn: false, drawnBy: null });
        }

        await batchMale.commit();
        await batchFemale.commit();

        localStorage.removeItem(`wichtelNummer_${appId}`);

        setLoading(false);
        showError("Lotterie (Männlich & Weiblich) erfolgreich zurückgesetzt! Seite wird neu geladen...");
        setTimeout(() => {
            window.location.reload(); 
        }, 2000);


    } catch (err) {
        console.error("Fehler beim Initialisieren:", err);
        setLoading(false);
        showError("Fehler beim Zurücksetzen der Lotterie.");
    }
}

// --- UI-Hilfsfunktionen (unverändert) ---

function setLoading(isLoading) {
    loadingDiv.classList.toggle('hidden', !isLoading);
    genderSelectionDiv.classList.toggle('hidden', isLoading); // Blendet den *ganzen* Auswahl-Container aus
    resultDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    if(isLoading) initClickCount = 0;
}

/**
 * Zeigt das Ergebnis an.
 * (Funktion unverändert)
 * @param {string | number} number Die gezogene Nummer
 * @param {boolean} [animate=false] Ob animiert werden soll
 * @param {'male' | 'female'} [gender] Das Geschlecht für den Text
 */
function showResult(number, animate = false, gender) {
    numberDisplay.textContent = number;
    
    if (gender) {
        const genderText = (gender === 'male') ? "Jungs" : "Mädels";
        resultIntroText.textContent = `Deine gezogene Wichtel-Nummer (Gruppe: ${genderText}) ist:`;
    } else {
        resultIntroText.textContent = `Deine gezogene Wichtel-Nummer ist:`;
    }

    if(animate) {
        resultDiv.classList.add('pop-out');
    }
    resultDiv.classList.remove('hidden');
    genderSelectionDiv.classList.add('hidden'); // Blendet Auswahl-Container bei Ergebnis aus
    loadingDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
}


function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    genderSelectionDiv.classList.add('hidden'); // Blendet Auswahl-Container bei Fehler aus
    loadingDiv.classList.add('hidden');
    resultDiv.classList.add('hidden');

    // Setzt den Status zurück, damit neu gewählt werden kann
    selectedGender = null;
    document.getElementById('btn-male').classList.remove('active');
    document.getElementById('btn-female').classList.remove('active');
    document.getElementById('drawButtonContainer').classList.add('hidden');
    
    if (!message.startsWith("Admin:") && !message.includes("erfolgreich zurückgesetzt")) {
         setTimeout(() => {
             if (localStorage.getItem(`wichtelNummer_${appId}`) == null) {
                 genderSelectionDiv.classList.remove('hidden'); // Zeigt Auswahl-Container wieder an
                 errorDiv.classList.add('hidden');

             }
         }, 3000);
    }
}

// --- Admin Sektion (unverändert) ---
function checkAdminMode() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === '1') {
        if (adminSection) {
            adminSection.classList.remove('hidden');
        }
    }
}

// --- Schneefall-Animation (unverändert) ---
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