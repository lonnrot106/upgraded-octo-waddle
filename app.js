import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc, onSnapshot, where, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// ============================================================================
// PWA & Service Worker
// ============================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
            reg.update();
        }).catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// ============================================================================
// Firebase Config
// ============================================================================
const firebaseConfig = {
    apiKey: "AIzaSyDw4MUBbihYWeYyRoy0ahxFjBdb6iyiGuM",
    authDomain: "baron-f8bd3.firebaseapp.com",
    projectId: "baron-f8bd3",
    storageBucket: "baron-f8bd3.firebasestorage.app",
    messagingSenderId: "835140618568",
    appId: "1:835140618568:web:75b2cf0ff5fe0e5215cb7d"
};

const isFirebaseMocked = firebaseConfig.projectId === "YOUR_PROJECT_ID";
let app, auth, db, messaging;
if (!isFirebaseMocked) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        messaging = getMessaging(app);
    } catch(e) {
        console.error("Firebase init error", e);
    }
}

// ============================================================================
// Sound Service (Web Audio API)
// ============================================================================
class SoundService {
    static init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    static playPop() {
        if (!Storage.getSoundEnabled()) return;
        try {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);

            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {
            console.debug('Audio error', e);
        }
    }

    static playSuccess() {
        if (!Storage.getSoundEnabled()) return;
        try {
            this.init();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chord

            notes.forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const noteTime = now + (i * 0.08);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, noteTime);

                gain.gain.setValueAtTime(0.18, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(noteTime);
                osc.stop(noteTime + 0.35);
            });
        } catch (e) {
            console.debug('Audio error', e);
        }
    }
}

// ============================================================================
// Storage Module
// ============================================================================
class Storage {
    static getApiKey() {
        return localStorage.getItem('gemini_api_key') || '';
    }

    static saveApiKey(key) {
        localStorage.setItem('gemini_api_key', key);
    }

    static getPrimaryModel() {
        return localStorage.getItem('gemini_primary_model') || 'gemini-3.5-flash-lite';
    }

    static savePrimaryModel(model) {
        localStorage.setItem('gemini_primary_model', model);
    }

    static getFallbackModel() {
        return localStorage.getItem('gemini_fallback_model') || 'gemini-3.1-flash-lite';
    }

    static saveFallbackModel(model) {
        localStorage.setItem('gemini_fallback_model', model);
    }

    static getFallbackEnabled() {
        const val = localStorage.getItem('gemini_fallback_enabled');
        return val === null ? true : val === 'true';
    }

    static saveFallbackEnabled(enabled) {
        localStorage.setItem('gemini_fallback_enabled', String(enabled));
    }

    static getSoundEnabled() {
        const val = localStorage.getItem('butler_sound_enabled');
        return val === null ? true : val === 'true';
    }

    static saveSoundEnabled(enabled) {
        localStorage.setItem('butler_sound_enabled', String(enabled));
    }

    static getTemperature() {
        const t = parseFloat(localStorage.getItem('gemini_temperature'));
        return isNaN(t) ? 0.7 : t;
    }

    static saveTemperature(temperature) {
        localStorage.setItem('gemini_temperature', temperature);
    }

    // Memory Management
    static getMemoryFacts() {
        const facts = localStorage.getItem('butler_memory_facts');
        return facts ? JSON.parse(facts) : [];
    }

    static saveMemoryFacts(facts) {
        const unique = Array.from(new Set(facts.map(f => f.trim()).filter(Boolean)));
        localStorage.setItem('butler_memory_facts', JSON.stringify(unique));
        this.syncMemoryWithCloud(unique);
        return unique;
    }

    static addMemoryFacts(newFacts) {
        if (!newFacts || !newFacts.length) return this.getMemoryFacts();
        const current = this.getMemoryFacts();
        newFacts.forEach(fact => {
            const trimmed = fact.trim();
            if (trimmed && !current.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
                current.push(trimmed);
            }
        });
        return this.saveMemoryFacts(current);
    }

    static removeMemoryFact(index) {
        const current = this.getMemoryFacts();
        if (index >= 0 && index < current.length) {
            current.splice(index, 1);
            return this.saveMemoryFacts(current);
        }
        return current;
    }

    static clearMemoryFacts() {
        localStorage.removeItem('butler_memory_facts');
        this.syncMemoryWithCloud([]);
    }

    static async syncMemoryWithCloud(facts) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            try {
                const docRef = doc(db, `users/${auth.currentUser.uid}/settings`, 'memory');
                await setDoc(docRef, { facts, updatedAt: Date.now() }, { merge: true });
            } catch (e) {
                console.error("Cloud memory sync failed", e);
            }
        }
    }

    static async loadMemoryFromCloud() {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            try {
                const docRef = doc(db, `users/${auth.currentUser.uid}/settings`, 'memory');
                const snap = await getDoc(docRef);
                if (snap.exists() && snap.data().facts) {
                    const cloudFacts = snap.data().facts;
                    const merged = this.addMemoryFacts(cloudFacts);
                    return merged;
                }
            } catch (e) {
                console.error("Failed to load cloud memory", e);
            }
        }
        return this.getMemoryFacts();
    }

    static localDateString(ts) {
        const d = new Date(ts || Date.now());
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    static planDate(plan) {
        if (plan.date) return plan.date;
        return Storage.localDateString(plan.timestamp || Date.now());
    }

    static async getPlans() {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const q = query(collection(db, `users/${auth.currentUser.uid}/plans`), orderBy('timestamp', 'desc'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
            const plans = localStorage.getItem('butler_plans');
            return plans ? JSON.parse(plans) : [];
        }
    }

    static async savePlan(plan) {
        plan.date = plan.date || Storage.localDateString(Date.now());
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const docRef = await addDoc(collection(db, `users/${auth.currentUser.uid}/plans`), plan);
            plan.id = docRef.id;
            return plan;
        } else {
            const plans = await this.getPlans();
            plan.id = Date.now().toString();
            plans.unshift(plan); 
            localStorage.setItem('butler_plans', JSON.stringify(plans));
            return plan;
        }
    }

    static async updatePlan(planId, patch) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const docRef = doc(db, `users/${auth.currentUser.uid}/plans`, planId);
            await updateDoc(docRef, patch);
        } else {
            const plans = await this.getPlans();
            const index = plans.findIndex(p => p.id === planId);
            if (index !== -1) {
                Object.assign(plans[index], patch);
                localStorage.setItem('butler_plans', JSON.stringify(plans));
            }
        }
    }

    static async deletePlansByKey(repeatKey) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const q = query(collection(db, `users/${auth.currentUser.uid}/plans`), where('repeatKey', '==', repeatKey));
            const snapshot = await getDocs(q);
            snapshot.forEach(async d => {
                await deleteDoc(doc(db, `users/${auth.currentUser.uid}/plans`, d.id));
            });
        } else {
            const plans = await this.getPlans();
            const remaining = plans.filter(p => p.repeatKey !== repeatKey);
            localStorage.setItem('butler_plans', JSON.stringify(remaining));
        }
    }

    static async clearPlans() {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const q = query(collection(db, `users/${auth.currentUser.uid}/plans`));
            const snapshot = await getDocs(q);
            snapshot.forEach(async d => {
                await deleteDoc(doc(db, `users/${auth.currentUser.uid}/plans`, d.id));
            });
        } else {
            localStorage.removeItem('butler_plans');
        }
    }

    static subscribePlans(onUpdate) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const q = query(collection(db, `users/${auth.currentUser.uid}/plans`), orderBy('timestamp', 'desc'));
            return onSnapshot(q, (snapshot) => {
                onUpdate(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            }, (error) => {
                console.error('Firestore sync error', error);
            });
        }
        return null;
    }
}

const VAPID_KEY = 'YOUR_VAPID_KEY';

// ============================================================================
// Notification Module
// ============================================================================
class NotificationService {
    static async requestPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                await Notification.requestPermission();
            }
        }
    }

    static scheduleNotifications(scheduleList) {
        if (Notification.permission !== 'granted') return;

        const now = new Date();
        scheduleList.forEach(item => {
            const timePart = item.time.split('-')[0].trim();
            const [hours, minutes] = timePart.split(':').map(Number);
            
            if (!isNaN(hours) && !isNaN(minutes)) {
                let target = new Date(now);
                target.setHours(hours, minutes, 0, 0);
                
                if (target > now) {
                    const delay = target.getTime() - now.getTime();
                    setTimeout(() => {
                        new Notification('AI Butler: Пора!', {
                            body: item.task,
                            icon: 'icon-192.png'
                        });
                    }, delay);
                }
            }
        });
    }
}

// ============================================================================
// Speech Module
// ============================================================================
class SpeechService {
    constructor(onResult, onEnd) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'ru-RU';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                if (this.currentHandler) {
                    this.currentHandler(transcript);
                } else if (onResult) {
                    onResult(transcript);
                }
            };
            this.recognition.onend = () => {
                if (this.currentEndHandler) {
                    this.currentEndHandler();
                } else if (onEnd) {
                    onEnd();
                }
            };
        } else {
            this.recognition = null;
        }
    }

    start(onResultCustom, onEndCustom) {
        if (this.recognition) {
            this.currentHandler = onResultCustom || null;
            this.currentEndHandler = onEndCustom || null;
            try {
                this.recognition.start();
            } catch(e) {
                console.warn('Speech already running', e);
            }
        } else {
            alert('Голосовой ввод не поддерживается в вашем браузере.');
        }
    }
}

// ============================================================================
// API Module with Fallback & Memory
// ============================================================================
class API {
    constructor() {
        this.primaryModel = Storage.getPrimaryModel();
        this.fallbackModel = Storage.getFallbackModel();
        this.fallbackEnabled = Storage.getFallbackEnabled();
        this.temperature = Storage.getTemperature();
    }

    updateConfig() {
        this.primaryModel = Storage.getPrimaryModel();
        this.fallbackModel = Storage.getFallbackModel();
        this.fallbackEnabled = Storage.getFallbackEnabled();
        this.temperature = Storage.getTemperature();
    }

    buildSystemContext(knownFacts) {
        let memoryPrompt = '';
        if (knownFacts && knownFacts.length > 0) {
            memoryPrompt = `\nДолговременная память о пользователе (учитывай эти факты при распределении нагрузки, времени и подборе отдыха):\n- ${knownFacts.join('\n- ')}\n`;
        }
        return memoryPrompt;
    }

    async callGeminiModel(modelName, prompt, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 35000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: this.temperature }
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData?.error?.message || response.statusText;
                const err = new Error(`API Error [${response.status}]: ${message}`);
                err.status = response.status;
                throw err;
            }

            const data = await response.json();
            let textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const start = textOutput.indexOf('{');
            const end = textOutput.lastIndexOf('}');
            if (start !== -1 && end > start) {
                textOutput = textOutput.slice(start, end + 1);
            }

            return JSON.parse(textOutput);
        } finally {
            clearTimeout(timeout);
        }
    }

    async executeWithSmartFallback(prompt, apiKey) {
        this.updateConfig();
        let lastError = null;

        // Try primary model first
        try {
            const parsed = await this.callGeminiModel(this.primaryModel, prompt, apiKey);
            return {
                data: parsed,
                usedFallback: false,
                modelUsed: this.primaryModel
            };
        } catch (error) {
            console.warn(`Primary model (${this.primaryModel}) error:`, error);
            lastError = error;

            // If rate limited / 429 / quota / 503 and fallback is allowed:
            const isRateLimitOrUnavailable = error.status === 429 || error.status === 503 || String(error.message).includes('429') || String(error.message).includes('RESOURCE_EXHAUSTED');
            
            if (this.fallbackEnabled && isRateLimitOrUnavailable && this.fallbackModel && this.fallbackModel !== this.primaryModel) {
                console.log(`Switching to Smart Fallback model: ${this.fallbackModel}...`);
                try {
                    const fallbackParsed = await this.callGeminiModel(this.fallbackModel, prompt, apiKey);
                    return {
                        data: fallbackParsed,
                        usedFallback: true,
                        modelUsed: this.fallbackModel
                    };
                } catch (fallbackError) {
                    console.error(`Fallback model (${this.fallbackModel}) also failed:`, fallbackError);
                    lastError = fallbackError;
                }
            }
        }

        throw lastError || new Error('Не удалось получить ответ от моделей Gemini.');
    }

    async generateScheduleAndRec(userInput, apiKey) {
        const knownFacts = Storage.getMemoryFacts();
        const memoryContext = this.buildSystemContext(knownFacts);

        const prompt = `Ты строгий, стильный и внимательный AI-Дворецкий. 
Твоя задача: взять скомканный поток мыслей пользователя и превратить его в идеальное расписание.
Также, если у пользователя есть свободное время, ты должен порекомендовать РОВНО ОДНУ вещь для отдыха (фильм, игра, музыкальный альбом, книга), идеально подходящую под настроение и вкусы пользователя.
Кроме того, если в сообщении пользователя есть новые факты о его привычках, графике, спорте, вкусах или биоритмах, выдели их в массив "newFacts" (краткие утверждения в 3-6 слов). Если ничего нового нет, верни пустой массив.
${memoryContext}
Ввод пользователя: "${userInput}"

Ответь СТРОГО в формате JSON без маркдаун-разметки (\`\`\`json) и без лишнего текста. Структура:
{
  "schedule": [
    {"time": "HH:MM - HH:MM", "task": "Название задачи", "done": false}
  ],
  "recommendation": {
    "type": "Фильм / Игра / Альбом / Книга",
    "title": "Название",
    "description": "Краткое обоснование в 1-2 предложения, почему это идеально подойдет сейчас."
  },
  "newFacts": ["Факт о пользователе 1"]
}`;

        return await this.executeWithSmartFallback(prompt, apiKey);
    }

    async refineSchedule(currentScheduleData, userInstruction, apiKey) {
        const knownFacts = Storage.getMemoryFacts();
        const memoryContext = this.buildSystemContext(knownFacts);

        const prompt = `Ты строгий, стильный и внимательный AI-Дворецкий.
У пользователя уже есть расписание:
${JSON.stringify(currentScheduleData.schedule, null, 2)}

Текущая рекомендация на вечер:
${JSON.stringify(currentScheduleData.recommendation, null, 2)}
${memoryContext}
Пользователь просит внести корректировку: "${userInstruction}"

Твоя задача:
1. Аккуратно скорректировать расписание согласно инструкции (сдвинуть время, заменить задачу, добавить/удалить).
2. ВАЖНО: Сохрани статус "done": true для задач, которые пользователь уже выполнил, если инструкция явно не отменяет их.
3. Если пользователь попросил сменить рекомендацию или изменился вечер, обнови рекомендацию.
4. Если из инструкции можно извлечь новый факт о пользователе (например, "не люблю комедии", "по вторникам бассейн"), добавь его в "newFacts".

Ответь СТРОГО в формате JSON без маркдаун-разметки (\`\`\`json) и без лишнего текста:
{
  "schedule": [
    {"time": "HH:MM - HH:MM", "task": "Название задачи", "done": false}
  ],
  "recommendation": {
    "type": "Фильм / Игра / Альбом / Книга",
    "title": "Название",
    "description": "Краткое обоснование."
  },
  "newFacts": []
}`;

        return await this.executeWithSmartFallback(prompt, apiKey);
    }
}

// ============================================================================
// UI Module
// ============================================================================
class UI {
    constructor() {
        this.elements = {
            authBtn: document.getElementById('authBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            organizeBtn: document.getElementById('organizeBtn'),
            resetBtn: document.getElementById('resetBtn'),
            micBtn: document.getElementById('micBtn'),
            braindump: document.getElementById('braindump'),
            resultsSection: document.getElementById('resultsSection'),
            loader: document.getElementById('loader'),
            outputContent: document.getElementById('outputContent'),
            scheduleList: document.getElementById('scheduleList'),
            repeatToggle: document.getElementById('repeatToggle'),
            dayProgress: document.getElementById('dayProgress'),
            dayProgressFill: document.getElementById('dayProgressFill'),
            dayProgressText: document.getElementById('dayProgressText'),
            recType: document.getElementById('recType'),
            recTitle: document.getElementById('recTitle'),
            recDescription: document.getElementById('recDescription'),
            modelBadge: document.getElementById('modelBadge'),
            followUpInput: document.getElementById('followUpInput'),
            followUpMicBtn: document.getElementById('followUpMicBtn'),
            followUpSendBtn: document.getElementById('followUpSendBtn'),
            apiKeyModal: document.getElementById('apiKeyModal'),
            apiKeyInput: document.getElementById('apiKeyInput'),
            primaryModelSelect: document.getElementById('primaryModelSelect'),
            fallbackModelSelect: document.getElementById('fallbackModelSelect'),
            fallbackCheckbox: document.getElementById('fallbackCheckbox'),
            soundCheckbox: document.getElementById('soundCheckbox'),
            temperatureInput: document.getElementById('temperatureInput'),
            temperatureValue: document.getElementById('temperatureValue'),
            memoryTagsContainer: document.getElementById('memoryTagsContainer'),
            newFactInput: document.getElementById('newFactInput'),
            addFactBtn: document.getElementById('addFactBtn'),
            clearMemoryBtn: document.getElementById('clearMemoryBtn'),
            saveApiBtn: document.getElementById('saveApiBtn'),
            closeApiBtn: document.getElementById('closeApiBtn'),
            inputSection: document.querySelector('.input-section'),
            historyBtn: document.getElementById('historyBtn'),
            historyModal: document.getElementById('historyModal'),
            historyListContainer: document.getElementById('historyListContainer'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            closeHistoryBtn: document.getElementById('closeHistoryBtn'),
            weekBtn: document.getElementById('weekBtn'),
            weekModal: document.getElementById('weekModal'),
            weekDays: document.getElementById('weekDays'),
            weekLabel: document.getElementById('weekLabel'),
            weekPrevBtn: document.getElementById('weekPrevBtn'),
            weekNextBtn: document.getElementById('weekNextBtn'),
            closeWeekBtn: document.getElementById('closeWeekBtn')
        };
        this.onPlanEdit = null;
        this.onPlanToggle = null;
        this.onRepeatToggle = null;
        this.onDeleteMemoryFact = null;
    }

    bindEvents(handlers) {
        this.elements.authBtn.addEventListener('click', handlers.onAuthClick);
        this.elements.settingsBtn.addEventListener('click', handlers.onSettingsClick);
        this.elements.closeApiBtn.addEventListener('click', handlers.onCloseModal);
        this.elements.saveApiBtn.addEventListener('click', handlers.onSaveApiKey);
        this.elements.organizeBtn.addEventListener('click', handlers.onOrganize);
        this.elements.resetBtn.addEventListener('click', handlers.onReset);
        this.elements.historyBtn.addEventListener('click', handlers.onHistoryClick);
        this.elements.closeHistoryBtn.addEventListener('click', handlers.onCloseHistoryModal);
        this.elements.clearHistoryBtn.addEventListener('click', handlers.onClearHistory);
        this.elements.micBtn.addEventListener('click', handlers.onMicClick);
        this.elements.weekBtn.addEventListener('click', handlers.onWeekClick);
        this.elements.closeWeekBtn.addEventListener('click', handlers.onCloseWeekModal);
        this.elements.weekPrevBtn.addEventListener('click', handlers.onWeekPrev);
        this.elements.weekNextBtn.addEventListener('click', handlers.onWeekNext);

        // Backdrop click to close modals
        [
            { modal: this.elements.apiKeyModal, closeHandler: handlers.onCloseModal },
            { modal: this.elements.historyModal, closeHandler: handlers.onCloseHistoryModal },
            { modal: this.elements.weekModal, closeHandler: handlers.onCloseWeekModal }
        ].forEach(({ modal, closeHandler }) => {
            if (!modal) return;
            modal.addEventListener('click', (e) => {
                if (e.target === modal && closeHandler) {
                    closeHandler();
                }
            });
        });

        // Global Escape key to close open modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isModalOpen(this.elements.apiKeyModal) && handlers.onCloseModal) {
                    handlers.onCloseModal();
                } else if (this.isModalOpen(this.elements.historyModal) && handlers.onCloseHistoryModal) {
                    handlers.onCloseHistoryModal();
                } else if (this.isModalOpen(this.elements.weekModal) && handlers.onCloseWeekModal) {
                    handlers.onCloseWeekModal();
                }
            }
        });

        // Follow-up events
        this.elements.followUpSendBtn.addEventListener('click', handlers.onFollowUpSend);
        this.elements.followUpMicBtn.addEventListener('click', handlers.onFollowUpMic);
        this.elements.followUpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handlers.onFollowUpSend();
        });

        // Memory events
        this.elements.addFactBtn.addEventListener('click', handlers.onAddFact);
        this.elements.newFactInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handlers.onAddFact();
        });
        this.elements.clearMemoryBtn.addEventListener('click', handlers.onClearMemory);
    }

    updateAuthButton(isLoggedIn) {
        if (isLoggedIn) {
            this.elements.authBtn.classList.add('logged-in');
            this.elements.authBtn.setAttribute('title', 'Выйти');
        } else {
            this.elements.authBtn.classList.remove('logged-in');
            this.elements.authBtn.setAttribute('title', 'Войти через Google');
        }
    }

    openModal(modalElement) {
        if (!modalElement) return;
        if (modalElement._closeTimeout) {
            clearTimeout(modalElement._closeTimeout);
            modalElement._closeTimeout = null;
        }
        modalElement.classList.remove('hidden');
        modalElement.classList.remove('closing');
        // Force reflow for CSS transition
        void modalElement.offsetHeight;
        modalElement.classList.add('is-open');
    }

    closeModal(modalElement, callback) {
        if (!modalElement) {
            if (callback) callback();
            return;
        }
        if (modalElement.classList.contains('hidden') || modalElement.classList.contains('closing')) {
            if (callback) callback();
            return;
        }
        modalElement.classList.remove('is-open');
        modalElement.classList.add('closing');

        if (modalElement._closeTimeout) {
            clearTimeout(modalElement._closeTimeout);
        }
        modalElement._closeTimeout = setTimeout(() => {
            modalElement.classList.add('hidden');
            modalElement.classList.remove('closing');
            modalElement._closeTimeout = null;
            if (callback) callback();
        }, 260);
    }

    isModalOpen(modalElement) {
        return modalElement && modalElement.classList.contains('is-open') && !modalElement.classList.contains('closing');
    }

    showModal(currentKey, primaryModel, fallbackModel, fallbackEnabled, soundEnabled, currentTemperature, memoryFacts) {
        this.elements.apiKeyInput.value = currentKey;
        this.elements.primaryModelSelect.value = primaryModel;
        this.elements.fallbackModelSelect.value = fallbackModel;
        this.elements.fallbackCheckbox.checked = fallbackEnabled;
        this.elements.soundCheckbox.checked = soundEnabled;
        this.elements.temperatureInput.value = currentTemperature;
        this.elements.temperatureValue.textContent = currentTemperature;
        this.renderMemoryTags(memoryFacts);
        this.openModal(this.elements.apiKeyModal);
    }

    renderMemoryTags(facts) {
        this.elements.memoryTagsContainer.innerHTML = '';
        if (!facts || facts.length === 0) {
            this.elements.memoryTagsContainer.innerHTML = '<span class="memory-empty">Дворецкий пока не сохранил фактов о вас. Общайтесь с ним, и он запомнит ваши привычки!</span>';
            return;
        }

        facts.forEach((fact, index) => {
            const tag = document.createElement('span');
            tag.className = 'memory-tag';
            tag.textContent = fact;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'memory-tag-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Удалить факт';
            removeBtn.addEventListener('click', () => {
                if (this.onDeleteMemoryFact) {
                    this.onDeleteMemoryFact(index);
                }
            });

            tag.appendChild(removeBtn);
            this.elements.memoryTagsContainer.appendChild(tag);
        });
    }

    hideModal(callback) {
        this.closeModal(this.elements.apiKeyModal, callback);
    }

    getSettingsValues() {
        return {
            apiKey: this.elements.apiKeyInput.value.trim(),
            primaryModel: this.elements.primaryModelSelect.value,
            fallbackModel: this.elements.fallbackModelSelect.value,
            fallbackEnabled: this.elements.fallbackCheckbox.checked,
            soundEnabled: this.elements.soundCheckbox.checked,
            temperature: parseFloat(this.elements.temperatureInput.value)
        };
    }

    getBraindumpText() {
        return this.elements.braindump.value.trim();
    }

    appendBraindumpText(text) {
        const current = this.elements.braindump.value;
        this.elements.braindump.value = current ? current + ' ' + text : text;
    }

    getFollowUpText() {
        return this.elements.followUpInput.value.trim();
    }

    setFollowUpText(text) {
        this.elements.followUpInput.value = text;
    }

    clearFollowUpInput() {
        this.elements.followUpInput.value = '';
    }

    setMicActive(isActive, buttonId = 'micBtn') {
        const btn = buttonId === 'followUpMicBtn' ? this.elements.followUpMicBtn : this.elements.micBtn;
        if (isActive) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    resetView() {
        this.elements.resultsSection.classList.add('hidden');
        this.elements.inputSection.style.display = 'block';
        setTimeout(() => {
            this.elements.inputSection.style.opacity = '1';
        }, 50);
        this.elements.braindump.value = '';
        this.elements.braindump.focus();
    }

    showLoader(message = 'Анализирую и планирую...') {
        const p = this.elements.loader.querySelector('p');
        if (p) p.textContent = message;
        
        if (this.elements.inputSection.style.display !== 'none') {
            this.elements.inputSection.style.opacity = '0';
            setTimeout(() => {
                this.elements.inputSection.style.display = 'none';
                this.elements.resultsSection.classList.remove('hidden');
                this.elements.loader.classList.remove('hidden');
                this.elements.outputContent.classList.add('hidden');
                this.elements.loader.setAttribute('aria-hidden', 'false');
            }, 300);
        } else {
            this.elements.loader.classList.remove('hidden');
            this.elements.outputContent.classList.add('hidden');
        }
    }

    renderResults(data, planId, repeat, repeatKey, usedFallback = false, modelUsed = '') {
        this.currentPlanId = planId;
        this.currentData = data;
        this.elements.repeatToggle.classList.toggle('active', !!repeat);
        this.elements.repeatToggle.dataset.repeatKey = repeatKey || '';
        
        // Model badge
        if (modelUsed) {
            this.elements.modelBadge.textContent = usedFallback ? `⚡ Fallback: ${modelUsed}` : modelUsed;
            this.elements.modelBadge.classList.toggle('fallback', !!usedFallback);
            this.elements.modelBadge.classList.remove('hidden');
        } else {
            this.elements.modelBadge.classList.add('hidden');
        }

        this.elements.scheduleList.innerHTML = '';
        data.schedule.forEach((item, index) => {
            const li = document.createElement('li');
            li.style.setProperty('--item-idx', index);
            
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'check';
            check.checked = !!item.done;
            check.setAttribute('aria-label', 'Отметить задачу выполненной');
            
            const timeSpan = document.createElement('span');
            timeSpan.className = 'time editable' + (item.done ? ' done' : '');
            timeSpan.contentEditable = 'true';
            timeSpan.spellcheck = false;
            timeSpan.setAttribute('role', 'textbox');
            timeSpan.setAttribute('aria-label', 'Время задачи');
            timeSpan.textContent = item.time;
            
            const taskSpan = document.createElement('span');
            taskSpan.className = 'task editable' + (item.done ? ' done' : '');
            taskSpan.contentEditable = 'true';
            taskSpan.spellcheck = false;
            taskSpan.setAttribute('role', 'textbox');
            taskSpan.setAttribute('aria-label', 'Текст задачи');
            taskSpan.textContent = item.task;

            check.addEventListener('change', () => {
                const isChecked = check.checked;
                this.currentData.schedule[index].done = isChecked;
                timeSpan.classList.toggle('done', isChecked);
                taskSpan.classList.toggle('done', isChecked);
                SoundService.playPop();
                if (this.onPlanToggle) this.onPlanToggle(this.currentPlanId, index, isChecked);
                this.updateProgress();
            });
            
            const saveEdit = () => {
                const newTime = timeSpan.textContent.trim();
                const newTask = taskSpan.textContent.trim();
                if (newTime) this.currentData.schedule[index].time = newTime;
                if (newTask) this.currentData.schedule[index].task = newTask;
                if (this.onPlanEdit) this.onPlanEdit(this.currentPlanId, this.currentData);
            };
            
            timeSpan.addEventListener('blur', saveEdit);
            taskSpan.addEventListener('blur', saveEdit);
            timeSpan.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    timeSpan.blur();
                }
            });
            taskSpan.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    taskSpan.blur();
                }
            });
            
            li.appendChild(check);
            li.appendChild(timeSpan);
            li.appendChild(taskSpan);
            this.elements.scheduleList.appendChild(li);
        });

        this.updateProgress(false);

        this.elements.recType.textContent = data.recommendation.type;
        this.elements.recTitle.textContent = data.recommendation.title;
        this.elements.recDescription.textContent = data.recommendation.description;

        this.elements.loader.classList.add('hidden');
        this.elements.loader.setAttribute('aria-hidden', 'true');
        this.elements.outputContent.classList.remove('hidden');
    }

    showError(message) {
        alert('Ошибка: ' + message);
    }

    updateProgress(triggerSound = true) {
        const total = this.currentData.schedule.length;
        const done = this.currentData.schedule.filter(i => i.done).length;
        this.elements.dayProgress.classList.toggle('hidden', total === 0);
        const percent = total ? (done / total * 100) : 0;
        this.elements.dayProgressFill.style.width = percent + '%';
        this.elements.dayProgressText.textContent = done + '/' + total;

        const progressBar = this.elements.dayProgress.querySelector('.day-progress-bar');
        if (total > 0 && done === total) {
            progressBar.classList.add('complete');
            if (triggerSound) SoundService.playSuccess();
        } else {
            progressBar.classList.remove('complete');
        }
    }

    showHistoryModal(plans, onPlanClick) {
        this.onHistoryPlanClick = onPlanClick;
        this.elements.historyListContainer.innerHTML = '';
        this.renderHistoryList(plans);
        this.openModal(this.elements.historyModal);
    }

    renderHistoryList(plans) {
        this.elements.historyListContainer.innerHTML = '';

        if (plans.length === 0) {
            this.elements.historyListContainer.innerHTML = '<p class="history-empty">История пуста</p>';
        } else {
            plans.forEach(plan => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'history-item';
                
                const dateSpan = document.createElement('span');
                dateSpan.className = 'history-item-date';
                dateSpan.textContent = new Date(plan.timestamp).toLocaleString('ru-RU');
                
                const promptSpan = document.createElement('span');
                promptSpan.className = 'history-item-prompt';
                promptSpan.textContent = plan.prompt;
                
                itemDiv.appendChild(dateSpan);
                itemDiv.appendChild(promptSpan);
                
                itemDiv.addEventListener('click', () => {
                    if (this.onHistoryPlanClick) this.onHistoryPlanClick(plan);
                });
                
                this.elements.historyListContainer.appendChild(itemDiv);
            });
        }
    }

    hideHistoryModal(callback) {
        this.closeModal(this.elements.historyModal, callback);
    }

    showWeekModal() {
        this.openModal(this.elements.weekModal);
    }

    hideWeekModal(callback) {
        this.closeModal(this.elements.weekModal, callback);
    }

    renderWeekDays(plans, monday, onPlanClick) {
        this.elements.weekDays.innerHTML = '';
        const todayStr = Storage.localDateString(Date.now());
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

        const tasksByDay = {};
        plans.forEach(plan => {
            const date = Storage.planDate(plan);
            const items = (plan.data && plan.data.schedule) || [];
            items.forEach(item => {
                if (!tasksByDay[date]) tasksByDay[date] = [];
                tasksByDay[date].push({ plan, item });
            });
        });

        for (let i = 0; i < 7; i++) {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            const dateStr = Storage.localDateString(day.getTime());
            const isToday = dateStr === todayStr;

            const dayDiv = document.createElement('div');
            dayDiv.className = 'week-day' + (isToday ? ' today' : '');

            const header = document.createElement('div');
            header.className = 'week-day-header';
            header.textContent = `${dayNames[i]} ${day.getDate()}.${String(day.getMonth() + 1).padStart(2, '0')}`;
            dayDiv.appendChild(header);

            const tasks = tasksByDay[dateStr] || [];
            if (tasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'week-day-empty';
                empty.textContent = 'Пусто';
                dayDiv.appendChild(empty);
            } else {
                tasks.forEach(({ plan, item }) => {
                    const task = document.createElement('div');
                    task.className = 'week-task' + (item.done ? ' done' : '');
                    const timeSpan = document.createElement('span');
                    timeSpan.className = 'week-task-time';
                    timeSpan.textContent = (item.time || '').split(' - ')[0].trim();
                    task.appendChild(timeSpan);
                    task.appendChild(document.createTextNode(item.task || ''));
                    task.addEventListener('click', () => onPlanClick(plan));
                    dayDiv.appendChild(task);
                });
            }

            this.elements.weekDays.appendChild(dayDiv);
        }
    }
}

// ============================================================================
// Main Application
// ============================================================================
class App {
    constructor() {
        this.api = new API();
        this.ui = new UI();
        this.apiKey = Storage.getApiKey();
        this.plans = [];
        
        this.speech = new SpeechService();

        this.init();
    }

    init() {
        this.ui.onPlanEdit = (planId, newData) => this.handlePlanEdit(planId, newData);
        this.ui.onPlanToggle = (planId, index, done) => this.handlePlanToggle(planId, index, done);
        this.ui.onRepeatToggle = (enabled) => this.handleRepeatToggle(enabled);
        this.ui.onDeleteMemoryFact = (index) => this.handleDeleteMemoryFact(index);

        this.ui.elements.repeatToggle.addEventListener('click', () => {
            const enabled = !this.ui.elements.repeatToggle.classList.contains('active');
            if (this.ui.onRepeatToggle) this.ui.onRepeatToggle(enabled);
        });

        this.ui.elements.temperatureInput.addEventListener('input', (e) => {
            this.ui.elements.temperatureValue.textContent = e.target.value;
        });

        this.ui.bindEvents({
            onAuthClick: () => this.handleAuth(),
            onSettingsClick: () => this.openSettings(),
            onCloseModal: () => this.ui.hideModal(),
            onSaveApiKey: () => this.handleSaveSettings(),
            onOrganize: () => this.handleOrganize(),
            onReset: () => this.ui.resetView(),
            onHistoryClick: () => this.handleHistoryClick(),
            onCloseHistoryModal: () => { this.historyModalOpen = false; this.ui.hideHistoryModal(); },
            onClearHistory: () => this.handleClearHistory(),
            onMicClick: () => this.handleMic(),
            onFollowUpMic: () => this.handleFollowUpMic(),
            onFollowUpSend: () => this.handleFollowUpSend(),
            onAddFact: () => this.handleAddFact(),
            onClearMemory: () => this.handleClearMemory(),
            onWeekClick: () => this.handleWeekClick(),
            onCloseWeekModal: () => { this.weekModalOpen = false; this.ui.hideWeekModal(); },
            onWeekPrev: () => { this.weekOffset -= 1; this.renderWeek(); },
            onWeekNext: () => { this.weekOffset += 1; this.renderWeek(); }
        });

        if (!isFirebaseMocked && auth) {
            onAuthStateChanged(auth, async (user) => {
                this.ui.updateAuthButton(!!user);
                if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
                this.plans = [];
                if (user) {
                    this.unsubscribe = Storage.subscribePlans((plans) => this.handlePlansUpdate(plans));
                    await Storage.loadMemoryFromCloud();
                }
            });
        }

        this.initPush();
        NotificationService.requestPermission();
    }

    openSettings() {
        this.ui.showModal(
            this.apiKey,
            Storage.getPrimaryModel(),
            Storage.getFallbackModel(),
            Storage.getFallbackEnabled(),
            Storage.getSoundEnabled(),
            Storage.getTemperature(),
            Storage.getMemoryFacts()
        );
    }

    handleDeleteMemoryFact(index) {
        const updated = Storage.removeMemoryFact(index);
        this.ui.renderMemoryTags(updated);
    }

    handleAddFact() {
        const input = this.ui.elements.newFactInput;
        const text = input.value.trim();
        if (text) {
            const updated = Storage.addMemoryFacts([text]);
            this.ui.renderMemoryTags(updated);
            input.value = '';
        }
    }

    handleClearMemory() {
        if (confirm('Очистить все воспоминания Дворецкого?')) {
            Storage.clearMemoryFacts();
            this.ui.renderMemoryTags([]);
        }
    }

    initPush() {
        if (isFirebaseMocked || !messaging || !VAPID_KEY || VAPID_KEY === 'YOUR_VAPID_KEY') {
            return;
        }
        try {
            onMessage(messaging, (payload) => {
                const title = (payload.notification && payload.notification.title) || 'AI Butler';
                const body = (payload.notification && payload.notification.body) || '';
                if (Notification.permission === 'granted') {
                    new Notification(title, { body, icon: 'icon-192.png' });
                }
            });
            if (Notification.permission === 'granted') {
                this.registerPushToken();
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') this.registerPushToken();
                });
            }
        } catch (error) {
            console.error('FCM init error', error);
        }
    }

    async registerPushToken() {
        try {
            const token = await getToken(messaging, { vapidKey: VAPID_KEY });
            console.log('FCM token:', token);
        } catch (error) {
            console.error('FCM token error', error);
        }
    }

    handlePlansUpdate(plans) {
        this.plans = plans;
        if (this.historyModalOpen) {
            this.ui.renderHistoryList(plans);
        }
        if (this.weekModalOpen) {
            this.renderWeek();
        }
        const current = this.ui.currentPlanId ? plans.find(p => p.id === this.ui.currentPlanId) : null;
        if (current && !this.historyModalOpen && !this.weekModalOpen) {
            this.ui.renderResults(current.data, current.id, current.repeat, current.repeatKey);
            NotificationService.scheduleNotifications(current.data.schedule);
        }
    }

    async handleAuth() {
        if (isFirebaseMocked) {
            alert("Firebase не настроен. Добавьте конфиг в app.js");
            return;
        }
        if (auth.currentUser) {
            await signOut(auth);
        } else {
            const provider = new GoogleAuthProvider();
            try {
                await signInWithPopup(auth, provider);
            } catch (error) {
                console.error("Auth error", error);
            }
        }
    }

    handleMic() {
        this.ui.setMicActive(true, 'micBtn');
        this.speech.start(
            (text) => this.ui.appendBraindumpText(text),
            () => this.ui.setMicActive(false, 'micBtn')
        );
    }

    handleFollowUpMic() {
        this.ui.setMicActive(true, 'followUpMicBtn');
        this.speech.start(
            (text) => this.ui.setFollowUpText(text),
            () => this.ui.setMicActive(false, 'followUpMicBtn')
        );
    }

    async handleHistoryClick() {
        this.historyModalOpen = true;
        this.weekModalOpen = false;
        this.ui.hideWeekModal();
        let plans = this.plans;
        if (plans.length === 0) {
            plans = await Storage.getPlans();
        }
        this.ui.showHistoryModal(plans, (plan) => this.handleLoadHistoricalPlan(plan));
    }

    async handleClearHistory() {
        await Storage.clearPlans();
        this.plans = [];
        this.ui.renderHistoryList([]);
    }

    async handleWeekClick() {
        this.weekModalOpen = true;
        this.historyModalOpen = false;
        this.ui.hideHistoryModal();
        this.weekOffset = 0;
        if (this.plans.length === 0) {
            this.plans = await Storage.getPlans();
        }
        this.ui.showWeekModal();
        this.renderWeek();
    }

    renderWeek() {
        const now = new Date();
        const monday = new Date(now);
        const day = (now.getDay() + 6) % 7;
        monday.setDate(now.getDate() - day + this.weekOffset * 7);
        monday.setHours(0, 0, 0, 0);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        this.ui.elements.weekLabel.textContent = `${Storage.localDateString(monday.getTime())} — ${Storage.localDateString(sunday.getTime())}`;

        this.ui.renderWeekDays(this.plans, monday, (plan) => this.handleLoadHistoricalPlan(plan));
    }

    handleLoadHistoricalPlan(plan) {
        this.historyModalOpen = false;
        this.weekModalOpen = false;
        this.ui.hideHistoryModal();
        this.ui.hideWeekModal();
        this.ui.showLoader();
        setTimeout(() => {
            this.ui.renderResults(plan.data, plan.id, plan.repeat, plan.repeatKey);
            NotificationService.scheduleNotifications(plan.data.schedule);
        }, 300);
    }

    handleSaveSettings() {
        const settings = this.ui.getSettingsValues();
        this.apiKey = settings.apiKey;
        Storage.saveApiKey(settings.apiKey);
        Storage.savePrimaryModel(settings.primaryModel);
        Storage.saveFallbackModel(settings.fallbackModel);
        Storage.saveFallbackEnabled(settings.fallbackEnabled);
        Storage.saveSoundEnabled(settings.soundEnabled);
        Storage.saveTemperature(settings.temperature);

        this.api.updateConfig();
        this.ui.hideModal();
    }

    async handlePlanEdit(planId, newData) {
        if (planId) {
            await Storage.updatePlan(planId, { data: newData });
            NotificationService.scheduleNotifications(newData.schedule);
        }
    }

    async handlePlanToggle(planId, index, done) {
        if (!planId) return;
        const data = this.ui.currentData;
        if (!data || !data.schedule[index]) return;
        data.schedule[index].done = done;
        await Storage.updatePlan(planId, { data });
    }

    async handleRepeatToggle(enabled) {
        const planId = this.ui.currentPlanId;
        if (!planId) return;
        if (this.plans.length === 0) {
            this.plans = await Storage.getPlans();
        }
        const current = this.plans.find(p => p.id === planId);
        if (!current) return;

        if (enabled) {
            const repeatKey = Date.now().toString();
            await Storage.updatePlan(planId, { repeat: true, repeatKey });
            for (let i = 1; i <= 6; i++) {
                const copyDate = new Date();
                copyDate.setDate(copyDate.getDate() + i);
                await Storage.savePlan({
                    timestamp: Date.now(),
                    prompt: current.prompt || '',
                    data: JSON.parse(JSON.stringify(current.data)),
                    repeat: true,
                    repeatKey,
                    date: Storage.localDateString(copyDate.getTime())
                });
            }
        } else {
            const oldKey = this.ui.elements.repeatToggle.dataset.repeatKey || current.repeatKey;
            await Storage.updatePlan(planId, { repeat: false, repeatKey: null });
            if (oldKey) await Storage.deletePlansByKey(oldKey);
        }
    }

    async handleOrganize() {
        const text = this.ui.getBraindumpText();
        
        if (!text) {
            this.ui.showError('Пожалуйста, напишите что-нибудь в поле ввода.');
            return;
        }
        
        if (!this.apiKey) {
            this.openSettings();
            return;
        }

        this.ui.showLoader('Анализирую хаос и создаю расписание...');

        try {
            const result = await this.api.generateScheduleAndRec(text, this.apiKey);
            const responseData = result.data;

            // Auto-learn facts
            if (responseData.newFacts && responseData.newFacts.length > 0) {
                Storage.addMemoryFacts(responseData.newFacts);
            }
            
            const savedPlan = await Storage.savePlan({
                timestamp: Date.now(),
                prompt: text,
                data: responseData
            });

            this.ui.renderResults(responseData, savedPlan.id, false, null, result.usedFallback, result.modelUsed);
            NotificationService.scheduleNotifications(responseData.schedule);
            
        } catch (error) {
            console.error(error);
            this.ui.showError(error.message);
            this.ui.resetView();
        }
    }

    async handleFollowUpSend() {
        const instruction = this.ui.getFollowUpText();
        if (!instruction) return;

        if (!this.apiKey) {
            this.openSettings();
            return;
        }

        const planId = this.ui.currentPlanId;
        const currentData = this.ui.currentData;

        if (!planId || !currentData) return;

        this.ui.showLoader('Дворецкий пересчитывает план...');
        this.ui.clearFollowUpInput();

        try {
            const result = await this.api.refineSchedule(currentData, instruction, this.apiKey);
            const updatedData = result.data;

            // Auto-learn facts
            if (updatedData.newFacts && updatedData.newFacts.length > 0) {
                Storage.addMemoryFacts(updatedData.newFacts);
            }

            await Storage.updatePlan(planId, { data: updatedData });

            this.ui.renderResults(updatedData, planId, this.ui.elements.repeatToggle.classList.contains('active'), this.ui.elements.repeatToggle.dataset.repeatKey, result.usedFallback, result.modelUsed);
            NotificationService.scheduleNotifications(updatedData.schedule);

        } catch (error) {
            console.error(error);
            this.ui.showError(error.message);
            if (this.ui.currentData) {
                this.ui.renderResults(this.ui.currentData, planId, false, null);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
