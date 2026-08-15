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
        return localStorage.getItem('gorouter_api_key') || localStorage.getItem('ai_api_key') || localStorage.getItem('gemini_api_key') || '';
    }

    static saveApiKey(key) {
        localStorage.setItem('gorouter_api_key', key);
    }

    static getBaseUrl() {
        return localStorage.getItem('ai_base_url') || 'https://gorouter.app/v1';
    }

    static saveBaseUrl(url) {
        localStorage.setItem('ai_base_url', url);
    }

    static getPrimaryModel() {
        return localStorage.getItem('ai_primary_model') || 'claude-opus-5-thinking';
    }

    static savePrimaryModel(model) {
        localStorage.setItem('ai_primary_model', model);
    }

    static getFallbackModel() {
        return localStorage.getItem('ai_fallback_model') || 'claude-opus-4-8';
    }

    static saveFallbackModel(model) {
        localStorage.setItem('ai_fallback_model', model);
    }

    static getFallbackEnabled() {
        return true;
    }

    static saveFallbackEnabled(enabled) {
        localStorage.setItem('ai_fallback_enabled', 'true');
    }

    static getSoundEnabled() {
        return true;
    }

    static saveSoundEnabled(enabled) {
        localStorage.setItem('butler_sound_enabled', 'true');
    }

    static getTemperature() {
        return 0.7;
    }

    static saveTemperature(temperature) {
        localStorage.setItem('ai_temperature', '0.7');
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

    static updateMemoryFact(index, newText) {
        const current = this.getMemoryFacts();
        if (index >= 0 && index < current.length) {
            const trimmed = (newText || '').trim();
            if (trimmed) {
                current[index] = trimmed;
            } else {
                current.splice(index, 1);
            }
            return this.saveMemoryFacts(current);
        }
        return current;
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

    static async deletePlan(planId) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            try {
                const docRef = doc(db, `users/${auth.currentUser.uid}/plans`, planId);
                await deleteDoc(docRef);
            } catch (e) {
                console.error("Failed to delete plan from Firestore", e);
            }
        }
        const local = localStorage.getItem('butler_plans');
        if (local) {
            try {
                const plans = JSON.parse(local);
                const remaining = plans.filter(p => p.id !== planId);
                localStorage.setItem('butler_plans', JSON.stringify(remaining));
            } catch (e) {}
        }
    }

    static async clearPlans() {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            try {
                const q = query(collection(db, `users/${auth.currentUser.uid}/plans`));
                const snapshot = await getDocs(q);
                snapshot.forEach(async d => {
                    await deleteDoc(doc(db, `users/${auth.currentUser.uid}/plans`, d.id));
                });
            } catch (e) {
                console.error("Failed to clear plans in Firestore", e);
            }
        }
        localStorage.removeItem('butler_plans');
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
// API Module with GoRouter (OpenAI-compatible) & Fallback & Memory
// ============================================================================
class API {
    constructor() {
        this.updateConfig();
    }

    updateConfig() {
        const base = Storage.getBaseUrl() || 'https://gorouter.app/v1';
        this.baseUrl = base.replace(/\/+$/, '');
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

    cleanAndParseJson(textOutput) {
        if (!textOutput || typeof textOutput !== 'string') {
            throw new Error('Пустой ответ от нейросети');
        }

        // Strip <think>...</think> tags if reasoning/thinking model used
        let cleaned = textOutput.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // Strip markdown code fences if wrapped
        cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();

        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end > start) {
            cleaned = cleaned.slice(start, end + 1);
        }

        const parsed = JSON.parse(cleaned);

        // Ensure schedule is sorted chronologically
        if (parsed.schedule && Array.isArray(parsed.schedule)) {
            parsed.schedule.sort((a, b) => {
                const timeA = (a.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
                const timeB = (b.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
                return timeA.localeCompare(timeB);
            });
        }

        return parsed;
    }

    async callChatModel(modelName, systemPrompt, userPrompt, apiKey) {
        const url = `${this.baseUrl}/chat/completions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: this.temperature
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData?.error?.message || errorData?.message || response.statusText;
                const err = new Error(`API Error [${response.status}]: ${message}`);
                err.status = response.status;
                throw err;
            }

            const data = await response.json();
            const textOutput = data.choices?.[0]?.message?.content || '';
            return this.cleanAndParseJson(textOutput);
        } finally {
            clearTimeout(timeout);
        }
    }

    async executeWithSmartFallback(systemPrompt, userPrompt, apiKey) {
        this.updateConfig();
        let lastError = null;

        // Try primary model first
        try {
            const parsed = await this.callChatModel(this.primaryModel, systemPrompt, userPrompt, apiKey);
            return {
                data: parsed,
                usedFallback: false,
                modelUsed: this.primaryModel
            };
        } catch (error) {
            console.warn(`Primary model (${this.primaryModel}) error:`, error);
            lastError = error;

            // If rate limited / 429 / quota / 503 and fallback is allowed:
            const isRateLimitOrUnavailable = error.status === 429 || error.status === 503 || error.status === 500 || String(error.message).includes('429') || String(error.message).includes('quota');
            
            if (this.fallbackEnabled && this.fallbackModel && this.fallbackModel !== this.primaryModel) {
                console.log(`Switching to Smart Fallback model: ${this.fallbackModel}...`);
                try {
                    const fallbackParsed = await this.callChatModel(this.fallbackModel, systemPrompt, userPrompt, apiKey);
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

        throw lastError || new Error('Не удалось получить ответ от моделей.');
    }

    async generateScheduleAndRec(userInput, apiKey) {
        const knownFacts = Storage.getMemoryFacts();
        const memoryContext = this.buildSystemContext(knownFacts);

        const systemPrompt = `Ты строгий, стильный и внимательный AI-Дворецкий. 
Твоя задача: взять скомканный поток мыслей пользователя и превратить его в идеальное расписание.
Также, если у пользователя есть свободное время, ты должен порекомендовать РОВНО ОДНУ вещь для отдыха (фильм, игра, музыкальный альбом, книга), идеально подходящую под настроение и вкусы пользователя.
Кроме того, если в сообщении пользователя есть новые факты о его привычках, графике, спорте, вкусах или биоритмах, выдели их в массив "newFacts" (краткие утверждения в 3-6 слов). Если ничего нового нет, верни пустой массив.
${memoryContext}
Ответь СТРОГО в формате JSON без какого-либо дополнительного текста вокруг:
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

        const userPrompt = `Ввод пользователя: "${userInput}"`;

        return await this.executeWithSmartFallback(systemPrompt, userPrompt, apiKey);
    }

    async refineSchedule(currentScheduleData, userInstruction, apiKey) {
        const knownFacts = Storage.getMemoryFacts();
        const memoryContext = this.buildSystemContext(knownFacts);

        const systemPrompt = `Ты строгий, стильный и внимательный AI-Дворецкий.
У пользователя уже есть расписание:
${JSON.stringify(currentScheduleData.schedule, null, 2)}

Текущая рекомендация на вечер:
${JSON.stringify(currentScheduleData.recommendation, null, 2)}
${memoryContext}
Твоя задача:
1. Аккуратно скорректировать расписание согласно инструкции пользователя (сдвинуть время, заменить задачу, добавить/удалить).
2. ВАЖНО: Сохрани статус "done": true для задач, которые пользователь уже выполнил, если инструкция явно не отменяет их.
3. Если пользователь попросил сменить рекомендацию или изменился вечер, обнови рекомендацию.
4. Если из инструкции можно извлечь новый факт о пользователе (например, "не люблю комедии", "по вторникам бассейн"), добавь его в "newFacts".

Ответь СТРОГО в формате JSON без какого-либо дополнительного текста вокруг:
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

        const userPrompt = `Инструкция по корректировке: "${userInstruction}"`;

        return await this.executeWithSmartFallback(systemPrompt, userPrompt, apiKey);
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
            dayProgress: document.getElementById('dayProgress'),
            dayProgressFill: document.getElementById('dayProgressFill'),
            dayProgressText: document.getElementById('dayProgressText'),
            recType: document.getElementById('recType'),
            recTitle: document.getElementById('recTitle'),
            recDescription: document.getElementById('recDescription'),
            followUpInput: document.getElementById('followUpInput'),
            followUpMicBtn: document.getElementById('followUpMicBtn'),
            followUpSendBtn: document.getElementById('followUpSendBtn'),
            apiKeyModal: document.getElementById('apiKeyModal'),
            closeSettingsIconBtn: document.getElementById('closeSettingsIconBtn'),
            tabBtnApi: document.getElementById('tabBtnApi'),
            tabBtnMemory: document.getElementById('tabBtnMemory'),
            tabPanelApi: document.getElementById('tabPanelApi'),
            tabPanelMemory: document.getElementById('tabPanelMemory'),
            memoryCountBadge: document.getElementById('memoryCountBadge'),
            apiKeyInput: document.getElementById('apiKeyInput'),
            toggleApiKeyVisibility: document.getElementById('toggleApiKeyVisibility'),
            apiBaseUrlInput: document.getElementById('apiBaseUrlInput'),
            primaryModelSelect: document.getElementById('primaryModelSelect'),
            fallbackModelSelect: document.getElementById('fallbackModelSelect'),
            memorySearchInput: document.getElementById('memorySearchInput'),
            memoryCardsContainer: document.getElementById('memoryCardsContainer'),
            newFactInput: document.getElementById('newFactInput'),
            addFactBtn: document.getElementById('addFactBtn'),
            clearMemoryBtn: document.getElementById('clearMemoryBtn'),
            saveApiBtn: document.getElementById('saveApiBtn'),
            closeApiBtn: document.getElementById('closeApiBtn'),
            closeMemoryModalBtn: document.getElementById('closeMemoryModalBtn'),
            inputSection: document.querySelector('.input-section'),
            historyBtn: document.getElementById('historyBtn'),
            historyModal: document.getElementById('historyModal'),
            historyListContainer: document.getElementById('historyListContainer'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            closeHistoryBtn: document.getElementById('closeHistoryBtn'),
            weekBtn: document.getElementById('weekBtn'),
            weekModal: document.getElementById('weekModal'),
            weekDaysBar: document.getElementById('weekDaysBar'),
            weekDayDetailTitle: document.getElementById('weekDayDetailTitle'),
            weekLoadPlanBtn: document.getElementById('weekLoadPlanBtn'),
            weekTasksList: document.getElementById('weekTasksList'),
            weekLabel: document.getElementById('weekLabel'),
            weekPrevBtn: document.getElementById('weekPrevBtn'),
            weekNextBtn: document.getElementById('weekNextBtn'),
            closeWeekBtn: document.getElementById('closeWeekBtn')
        };
        this.onPlanEdit = null;
        this.onPlanToggle = null;
        this.onDeleteMemoryFact = null;
        this.onEditMemoryFact = null;
        this.allMemoryFacts = [];
        this.currentSettingsTab = 'api';
    }

    bindEvents(handlers) {
        this.elements.authBtn?.addEventListener('click', handlers.onAuthClick);
        this.elements.settingsBtn?.addEventListener('click', handlers.onSettingsClick);
        this.elements.closeApiBtn?.addEventListener('click', handlers.onCloseModal);
        this.elements.closeSettingsIconBtn?.addEventListener('click', handlers.onCloseModal);
        this.elements.closeMemoryModalBtn?.addEventListener('click', handlers.onCloseModal);
        this.elements.saveApiBtn?.addEventListener('click', handlers.onSaveApiKey);
        this.elements.organizeBtn?.addEventListener('click', handlers.onOrganize);
        this.elements.resetBtn?.addEventListener('click', handlers.onReset);
        this.elements.historyBtn?.addEventListener('click', handlers.onHistoryClick);
        this.elements.closeHistoryBtn?.addEventListener('click', handlers.onCloseHistoryModal);
        this.elements.clearHistoryBtn?.addEventListener('click', handlers.onClearHistory);
        this.elements.micBtn?.addEventListener('click', handlers.onMicClick);
        this.elements.weekBtn?.addEventListener('click', handlers.onWeekClick);
        this.elements.closeWeekBtn?.addEventListener('click', handlers.onCloseWeekModal);
        this.elements.weekPrevBtn?.addEventListener('click', handlers.onWeekPrev);
        this.elements.weekNextBtn?.addEventListener('click', handlers.onWeekNext);

        // Settings Tabs
        this.elements.tabBtnApi?.addEventListener('click', () => this.switchSettingsTab('api'));
        this.elements.tabBtnMemory?.addEventListener('click', () => this.switchSettingsTab('memory'));

        // API Key Show/Hide Toggle
        this.elements.toggleApiKeyVisibility?.addEventListener('click', () => this.togglePasswordVisibility());

        // Memory Search
        this.elements.memorySearchInput?.addEventListener('input', (e) => {
            this.renderMemoryCards(this.allMemoryFacts, e.target.value);
        });

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
        this.elements.followUpSendBtn?.addEventListener('click', handlers.onFollowUpSend);
        this.elements.followUpMicBtn?.addEventListener('click', handlers.onFollowUpMic);
        this.elements.followUpInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handlers.onFollowUpSend();
        });

        // Memory events
        this.elements.addFactBtn?.addEventListener('click', handlers.onAddFact);
        this.elements.newFactInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handlers.onAddFact();
        });
        this.elements.clearMemoryBtn?.addEventListener('click', handlers.onClearMemory);
    }

    switchSettingsTab(tabName) {
        this.currentSettingsTab = tabName;
        if (tabName === 'api') {
            this.elements.tabBtnApi?.classList.add('active');
            this.elements.tabBtnApi?.setAttribute('aria-selected', 'true');
            this.elements.tabPanelApi?.classList.add('active');

            this.elements.tabBtnMemory?.classList.remove('active');
            this.elements.tabBtnMemory?.setAttribute('aria-selected', 'false');
            this.elements.tabPanelMemory?.classList.remove('active');
        } else {
            this.elements.tabBtnMemory?.classList.add('active');
            this.elements.tabBtnMemory?.setAttribute('aria-selected', 'true');
            this.elements.tabPanelMemory?.classList.add('active');

            this.elements.tabBtnApi?.classList.remove('active');
            this.elements.tabBtnApi?.setAttribute('aria-selected', 'false');
            this.elements.tabPanelApi?.classList.remove('active');

            // Focus search or add input on memory tab
            setTimeout(() => {
                this.elements.newFactInput?.focus();
            }, 100);
        }
    }

    togglePasswordVisibility() {
        const input = this.elements.apiKeyInput;
        const btn = this.elements.toggleApiKeyVisibility;
        if (!input || !btn) return;
        if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = '<span class="eye-icon">🙈</span>';
            btn.title = 'Скрыть ключ';
        } else {
            input.type = 'password';
            btn.innerHTML = '<span class="eye-icon">👁️</span>';
            btn.title = 'Показать ключ';
        }
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

    showModal(currentKey, baseUrl, primaryModel, fallbackModel, fallbackEnabled, soundEnabled, currentTemperature, memoryFacts) {
        if (this.elements.apiKeyInput) {
            this.elements.apiKeyInput.value = currentKey || '';
            this.elements.apiKeyInput.type = 'password';
        }
        if (this.elements.toggleApiKeyVisibility) {
            this.elements.toggleApiKeyVisibility.innerHTML = '<span class="eye-icon">👁️</span>';
            this.elements.toggleApiKeyVisibility.title = 'Показать ключ';
        }
        if (this.elements.apiBaseUrlInput) {
            this.elements.apiBaseUrlInput.value = baseUrl || 'https://gorouter.app/v1';
        }
        if (this.elements.primaryModelSelect) {
            this.elements.primaryModelSelect.value = primaryModel;
        }
        if (this.elements.fallbackModelSelect) {
            this.elements.fallbackModelSelect.value = fallbackModel;
        }
        if (this.elements.memorySearchInput) {
            this.elements.memorySearchInput.value = '';
        }
        if (this.elements.newFactInput) {
            this.elements.newFactInput.value = '';
        }

        this.allMemoryFacts = memoryFacts || [];
        this.renderMemoryCards(this.allMemoryFacts);
        this.switchSettingsTab('api');
        this.openModal(this.elements.apiKeyModal);
    }

    renderMemoryCards(facts, filterQuery = '') {
        this.allMemoryFacts = facts || [];
        if (this.elements.memoryCountBadge) {
            this.elements.memoryCountBadge.textContent = this.allMemoryFacts.length;
        }

        const container = this.elements.memoryCardsContainer;
        if (!container) return;
        container.innerHTML = '';

        if (!this.allMemoryFacts || this.allMemoryFacts.length === 0) {
            container.innerHTML = `
                <div class="memory-empty-state">
                    <div class="memory-empty-icon">🧠</div>
                    <p class="memory-empty-text">Дворецкий пока не сохранил заметок о вас. Общайтесь с ним, и он запомнит ваши привычки!</p>
                </div>
            `;
            return;
        }

        const q = (filterQuery || '').trim().toLowerCase();
        const filtered = this.allMemoryFacts
            .map((fact, index) => ({ fact, index }))
            .filter(item => !q || item.fact.toLowerCase().includes(q));

        if (filtered.length === 0) {
            const escapedQuery = this.escapeHtml(filterQuery);
            container.innerHTML = `
                <div class="memory-empty-state">
                    <div class="memory-empty-icon">🔍</div>
                    <p class="memory-empty-text">По запросу «${escapedQuery}» ничего не найдено.</p>
                </div>
            `;
            return;
        }

        filtered.forEach(({ fact, index }) => {
            const card = document.createElement('div');
            card.className = 'memory-card';
            card.setAttribute('role', 'listitem');

            const icon = document.createElement('span');
            icon.className = 'memory-card-icon';
            icon.textContent = '💭';

            const textSpan = document.createElement('span');
            textSpan.className = 'memory-card-content';
            textSpan.textContent = fact;
            textSpan.title = 'Кликните для редактирования';

            const actions = document.createElement('div');
            actions.className = 'memory-card-actions';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'memory-card-btn edit-btn';
            editBtn.innerHTML = '✎';
            editBtn.title = 'Редактировать';

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'memory-card-btn delete-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = 'Удалить факт';

            const startEditing = () => {
                card.classList.add('editing');
                card.innerHTML = '';

                const form = document.createElement('div');
                form.className = 'memory-edit-form';

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'memory-edit-input';
                input.value = fact;

                const editActions = document.createElement('div');
                editActions.className = 'memory-edit-actions';

                const saveBtn = document.createElement('button');
                saveBtn.type = 'button';
                saveBtn.className = 'memory-edit-save-btn';
                saveBtn.textContent = 'Сохранить';

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'memory-edit-cancel-btn';
                cancelBtn.textContent = 'Отмена';

                const commitEdit = () => {
                    const newVal = input.value.trim();
                    if (this.onEditMemoryFact) {
                        this.onEditMemoryFact(index, newVal);
                    }
                };

                const cancelEdit = () => {
                    this.renderMemoryCards(this.allMemoryFacts, this.elements.memorySearchInput ? this.elements.memorySearchInput.value : '');
                };

                saveBtn.addEventListener('click', commitEdit);
                cancelBtn.addEventListener('click', cancelEdit);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commitEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    }
                });

                form.appendChild(input);
                editActions.appendChild(saveBtn);
                editActions.appendChild(cancelBtn);
                form.appendChild(editActions);
                card.appendChild(form);

                input.focus();
                input.select();
            };

            textSpan.addEventListener('click', startEditing);
            editBtn.addEventListener('click', startEditing);
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onDeleteMemoryFact) {
                    this.onDeleteMemoryFact(index);
                }
            });

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            card.appendChild(icon);
            card.appendChild(textSpan);
            card.appendChild(actions);

            container.appendChild(card);
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    hideModal(callback) {
        this.closeModal(this.elements.apiKeyModal, callback);
    }

    getSettingsValues() {
        return {
            apiKey: this.elements.apiKeyInput ? this.elements.apiKeyInput.value.trim() : '',
            baseUrl: this.elements.apiBaseUrlInput ? this.elements.apiBaseUrlInput.value.trim() : 'https://gorouter.app/v1',
            primaryModel: this.elements.primaryModelSelect ? this.elements.primaryModelSelect.value : 'claude-opus-5-thinking',
            fallbackModel: this.elements.fallbackModelSelect ? this.elements.fallbackModelSelect.value : 'claude-opus-4-8',
            fallbackEnabled: true,
            soundEnabled: true,
            temperature: 0.7
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

    renderResults(data, planId) {
        this.currentPlanId = planId;
        this.currentData = data;

        // Ensure schedule is sorted chronologically
        if (data.schedule && Array.isArray(data.schedule)) {
            data.schedule.sort((a, b) => {
                const timeA = (a.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
                const timeB = (b.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
                return timeA.localeCompare(timeB);
            });
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

        if (!plans || plans.length === 0) {
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
                promptSpan.textContent = plan.prompt || '(Без описания)';
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'history-item-delete';
                deleteBtn.innerHTML = '&times;';
                deleteBtn.title = 'Удалить этот план';
                deleteBtn.setAttribute('aria-label', 'Удалить план');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onDeletePlan) {
                        this.onDeletePlan(plan.id);
                    }
                });

                itemDiv.appendChild(dateSpan);
                itemDiv.appendChild(promptSpan);
                itemDiv.appendChild(deleteBtn);
                
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

    renderWeekView(plans, monday, selectedDayIndex, onSelectDay, onLoadPlan) {
        this.elements.weekDaysBar.innerHTML = '';
        this.elements.weekTasksList.innerHTML = '';

        const todayStr = Storage.localDateString(Date.now());
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const fullDayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
        const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

        const tasksByDay = {};
        const planByDay = {};
        (plans || []).forEach(plan => {
            const date = Storage.planDate(plan);
            if (!planByDay[date]) planByDay[date] = plan;
            const items = (plan.data && plan.data.schedule) || [];
            items.forEach(item => {
                if (!tasksByDay[date]) tasksByDay[date] = [];
                tasksByDay[date].push(item);
            });
        });

        // 1. Render 7 day tabs
        for (let i = 0; i < 7; i++) {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            const dateStr = Storage.localDateString(day.getTime());
            const isToday = dateStr === todayStr;
            const isSelected = i === selectedDayIndex;
            const hasTasks = (tasksByDay[dateStr] || []).length > 0;

            const tab = document.createElement('div');
            tab.className = `week-day-tab${isSelected ? ' active' : ''}${isToday ? ' today' : ''}`;
            tab.setAttribute('role', 'button');
            tab.setAttribute('tabindex', '0');
            tab.title = `${fullDayNames[i]}, ${day.getDate()} ${monthNames[day.getMonth()]}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'week-day-tab-name';
            nameSpan.textContent = dayNames[i];

            const numSpan = document.createElement('span');
            numSpan.className = 'week-day-tab-num';
            numSpan.textContent = day.getDate();

            tab.appendChild(nameSpan);
            tab.appendChild(numSpan);

            if (hasTasks) {
                const dot = document.createElement('div');
                dot.className = 'week-day-tab-dot';
                tab.appendChild(dot);
            }

            tab.addEventListener('click', () => onSelectDay(i));
            this.elements.weekDaysBar.appendChild(tab);
        }

        // 2. Render selected day header & tasks
        const selectedDay = new Date(monday);
        selectedDay.setDate(monday.getDate() + selectedDayIndex);
        const selectedDateStr = Storage.localDateString(selectedDay.getTime());
        const selectedTasks = tasksByDay[selectedDateStr] || [];
        const planForSelectedDay = planByDay[selectedDateStr];

        this.elements.weekDayDetailTitle.textContent = `${fullDayNames[selectedDayIndex]}, ${selectedDay.getDate()} ${monthNames[selectedDay.getMonth()]}`;

        // "Open Plan" button
        if (planForSelectedDay && onLoadPlan) {
            this.elements.weekLoadPlanBtn.classList.remove('hidden');
            this.elements.weekLoadPlanBtn.onclick = () => onLoadPlan(planForSelectedDay);
        } else {
            this.elements.weekLoadPlanBtn.classList.add('hidden');
        }

        // Sort tasks chronologically
        selectedTasks.sort((a, b) => {
            const timeA = (a.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
            const timeB = (b.time || '').match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
            return timeA.localeCompare(timeB);
        });

        if (selectedTasks.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'week-no-tasks';
            emptyDiv.textContent = 'На этот день планов нет';
            this.elements.weekTasksList.appendChild(emptyDiv);
        } else {
            selectedTasks.forEach(task => {
                const itemDiv = document.createElement('div');
                itemDiv.className = `week-task-item${task.done ? ' done' : ''}`;

                const timeSpan = document.createElement('span');
                timeSpan.className = 'week-task-item-time';
                timeSpan.textContent = task.time || '';

                const textSpan = document.createElement('span');
                textSpan.className = 'week-task-item-name';
                textSpan.textContent = task.task || '';

                itemDiv.appendChild(timeSpan);
                itemDiv.appendChild(textSpan);
                this.elements.weekTasksList.appendChild(itemDiv);
            });
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
        this.weekOffset = 0;
        this.weekSelectedDayIndex = (new Date().getDay() + 6) % 7;
        
        this.speech = new SpeechService();

        this.init();
    }

    async init() {
        this.ui.onPlanEdit = (planId, newData) => this.handlePlanEdit(planId, newData);
        this.ui.onPlanToggle = (planId, index, done) => this.handlePlanToggle(planId, index, done);
        this.ui.onDeleteMemoryFact = (index) => this.handleDeleteMemoryFact(index);
        this.ui.onEditMemoryFact = (index, newText) => this.handleEditMemoryFact(index, newText);
        this.ui.onDeletePlan = (planId) => this.handleDeletePlan(planId);

        // One-time clean slate reset of corrupted/duplicate future plans
        if (!localStorage.getItem('butler_clean_slate_v3')) {
            await Storage.clearPlans();
            localStorage.setItem('butler_clean_slate_v3', 'true');
        }

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
                    if (!localStorage.getItem(`butler_clean_slate_v3_${user.uid}`)) {
                        await Storage.clearPlans();
                        localStorage.setItem(`butler_clean_slate_v3_${user.uid}`, 'true');
                    }
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
            Storage.getBaseUrl(),
            Storage.getPrimaryModel(),
            Storage.getFallbackModel(),
            Storage.getFallbackEnabled(),
            Storage.getSoundEnabled(),
            Storage.getTemperature(),
            Storage.getMemoryFacts()
        );
    }

    handleEditMemoryFact(index, newText) {
        const updated = Storage.updateMemoryFact(index, newText);
        const searchVal = this.ui.elements.memorySearchInput ? this.ui.elements.memorySearchInput.value : '';
        this.ui.renderMemoryCards(updated, searchVal);
    }

    handleDeleteMemoryFact(index) {
        const updated = Storage.removeMemoryFact(index);
        const searchVal = this.ui.elements.memorySearchInput ? this.ui.elements.memorySearchInput.value : '';
        this.ui.renderMemoryCards(updated, searchVal);
    }

    handleAddFact() {
        const input = this.ui.elements.newFactInput;
        const text = input ? input.value.trim() : '';
        if (text) {
            const updated = Storage.addMemoryFacts([text]);
            const searchVal = this.ui.elements.memorySearchInput ? this.ui.elements.memorySearchInput.value : '';
            this.ui.renderMemoryCards(updated, searchVal);
            if (input) input.value = '';
        }
    }

    handleClearMemory() {
        if (confirm('Очистить все воспоминания Дворецкого?')) {
            Storage.clearMemoryFacts();
            this.ui.renderMemoryCards([]);
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
        if (this.weekModalOpen) {
            this.renderWeek();
        }
    }

    async handleDeletePlan(planId) {
        if (!planId) return;
        await Storage.deletePlan(planId);
        this.plans = this.plans.filter(p => p.id !== planId);
        this.ui.renderHistoryList(this.plans);
        if (this.weekModalOpen) {
            this.renderWeek();
        }
        if (this.ui.currentPlanId === planId) {
            this.ui.resetView();
        }
    }

    async handleWeekClick() {
        this.weekModalOpen = true;
        this.historyModalOpen = false;
        this.ui.hideHistoryModal();
        this.weekOffset = 0;
        this.weekSelectedDayIndex = (new Date().getDay() + 6) % 7;
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

        this.ui.renderWeekView(
            this.plans,
            monday,
            this.weekSelectedDayIndex,
            (newIndex) => {
                this.weekSelectedDayIndex = newIndex;
                this.renderWeek();
            },
            (plan) => this.handleLoadHistoricalPlan(plan)
        );
    }

    handleLoadHistoricalPlan(plan) {
        this.historyModalOpen = false;
        this.weekModalOpen = false;
        this.ui.hideHistoryModal();
        this.ui.hideWeekModal();
        this.ui.showLoader();
        setTimeout(() => {
            this.ui.renderResults(plan.data, plan.id);
            NotificationService.scheduleNotifications(plan.data.schedule);
        }, 300);
    }

    handleSaveSettings() {
        const settings = this.ui.getSettingsValues();
        this.apiKey = settings.apiKey;
        Storage.saveApiKey(settings.apiKey);
        Storage.saveBaseUrl(settings.baseUrl);
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

            this.ui.renderResults(responseData, savedPlan.id);
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

            this.ui.renderResults(updatedData, planId);
            NotificationService.scheduleNotifications(updatedData.schedule);

        } catch (error) {
            console.error(error);
            this.ui.showError(error.message);
            if (this.ui.currentData) {
                this.ui.renderResults(this.ui.currentData, planId);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
