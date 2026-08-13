import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc, onSnapshot, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// ============================================================================
// PWA & Service Worker
// ============================================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// ============================================================================
// Firebase Config
// ============================================================================
// ВСТАВЬТЕ ВАШИ ДАННЫЕ FIREBASE СЮДА
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
// Storage Module
// ============================================================================
class Storage {
    static getApiKey() {
        return localStorage.getItem('gemini_api_key') || '';
    }

    static saveApiKey(key) {
        localStorage.setItem('gemini_api_key', key);
    }

    static getModel() {
        return localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
    }

    static saveModel(model) {
        localStorage.setItem('gemini_model', model);
    }

    static getTemperature() {
        const t = parseFloat(localStorage.getItem('gemini_temperature'));
        return isNaN(t) ? 0.7 : t;
    }

    static saveTemperature(temperature) {
        localStorage.setItem('gemini_temperature', temperature);
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

// Вставьте VAPID-ключ из Firebase Console → Cloud Messaging → Web Push certificates
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
                onResult(transcript);
            };
            this.recognition.onend = () => {
                if (onEnd) onEnd();
            }
        } else {
            this.recognition = null;
        }
    }

    start() {
        if (this.recognition) {
            this.recognition.start();
        } else {
            alert('Голосовой ввод не поддерживается в вашем браузере.');
        }
    }
}

// ============================================================================
// API Module
// ============================================================================
class API {
    constructor() {
        this.modelName = Storage.getModel();
        this.temperature = Storage.getTemperature();
    }

    async generateScheduleAndRec(userInput, apiKey) {
        const prompt = `Ты строгий, стильный AI-Дворецкий. Твоя задача: взять скомканный поток мыслей пользователя и превратить его в идеальное расписание.
Также, если у пользователя есть свободное время, ты должен порекомендовать РОВНО ОДНУ вещь для отдыха (фильм, игра, музыкальный альбом, книга), идеально подходящую под настроение пользователя.

Ввод пользователя: "${userInput}"

Ответь СТРОГО в формате JSON без маркдаун-разметки (\`\`\`json) и без лишнего текста. Структура:
{
  "schedule": [
    {"time": "HH:MM - HH:MM", "task": "Название задачи"}
  ],
  "recommendation": {
    "type": "Фильм / Игра / Альбом / Книга",
    "title": "Название",
    "description": "Краткое обоснование в 1-2 предложения, почему это идеально подойдет сейчас."
  }
}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${apiKey}`;
        
        const maxAttempts = 3;
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
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
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                let textOutput = data.candidates[0].content.parts[0].text;
                const start = textOutput.indexOf('{');
                const end = textOutput.lastIndexOf('}');
                if (start !== -1 && end > start) {
                    textOutput = textOutput.slice(start, end + 1);
                }

                try {
                    return JSON.parse(textOutput);
                } catch (parseError) {
                    lastError = new Error('Не удалось разобрать ответ модели. Попробуйте ещё раз.');
                }
            } catch (fetchError) {
                lastError = fetchError;
            } finally {
                clearTimeout(timeout);
            }
        }
        throw lastError;
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
            apiKeyModal: document.getElementById('apiKeyModal'),
            apiKeyInput: document.getElementById('apiKeyInput'),
            modelSelect: document.getElementById('modelSelect'),
            temperatureInput: document.getElementById('temperatureInput'),
            temperatureValue: document.getElementById('temperatureValue'),
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

    showModal(currentKey, currentModel, currentTemperature) {
        this.elements.apiKeyInput.value = currentKey;
        this.elements.modelSelect.value = currentModel;
        this.elements.temperatureInput.value = currentTemperature;
        this.elements.temperatureValue.textContent = currentTemperature;
        this.elements.apiKeyModal.classList.remove('hidden');
    }

    hideModal() {
        this.elements.apiKeyModal.classList.add('hidden');
    }

    getApiKeyInput() {
        return this.elements.apiKeyInput.value.trim();
    }

    getModelInput() {
        return this.elements.modelSelect.value;
    }

    getTemperatureInput() {
        return parseFloat(this.elements.temperatureInput.value);
    }

    getBraindumpText() {
        return this.elements.braindump.value.trim();
    }

    appendBraindumpText(text) {
        const current = this.elements.braindump.value;
        this.elements.braindump.value = current ? current + ' ' + text : text;
    }

    setMicActive(isActive) {
        if (isActive) {
            this.elements.micBtn.classList.add('active');
        } else {
            this.elements.micBtn.classList.remove('active');
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

    showLoader() {
        this.elements.inputSection.style.opacity = '0';
        setTimeout(() => {
            this.elements.inputSection.style.display = 'none';
            this.elements.resultsSection.classList.remove('hidden');
            this.elements.loader.classList.remove('hidden');
            this.elements.outputContent.classList.add('hidden');
            this.elements.loader.setAttribute('aria-hidden', 'false');
        }, 300);
    }

    renderResults(data, planId, repeat, repeatKey) {
        this.currentPlanId = planId;
        this.currentData = data;
        this.elements.repeatToggle.classList.toggle('active', !!repeat);
        this.elements.repeatToggle.dataset.repeatKey = repeatKey || '';
        
        this.elements.scheduleList.innerHTML = '';
        data.schedule.forEach((item, index) => {
            const li = document.createElement('li');
            
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'check';
            check.checked = !!item.done;
            check.setAttribute('aria-label', 'Отметить задачу выполненной');
            check.addEventListener('change', () => {
                this.currentData.schedule[index].done = check.checked;
                if (this.onPlanToggle) this.onPlanToggle(this.currentPlanId, index, check.checked);
                this.updateProgress();
            });
            
            const timeInput = document.createElement('input');
            timeInput.className = 'time editable' + (item.done ? ' done' : '');
            timeInput.value = item.time;
            
            const taskInput = document.createElement('input');
            taskInput.className = 'task editable' + (item.done ? ' done' : '');
            taskInput.value = item.task;
            
            const saveEdit = () => {
                this.currentData.schedule[index].time = timeInput.value;
                this.currentData.schedule[index].task = taskInput.value;
                if (this.onPlanEdit) this.onPlanEdit(this.currentPlanId, this.currentData);
            };
            
            timeInput.addEventListener('blur', saveEdit);
            taskInput.addEventListener('blur', saveEdit);
            timeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') timeInput.blur(); });
            taskInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') taskInput.blur(); });
            
            li.appendChild(check);
            li.appendChild(timeInput);
            li.appendChild(taskInput);
            this.elements.scheduleList.appendChild(li);
        });

        this.updateProgress();

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

    updateProgress() {
        const total = this.currentData.schedule.length;
        const done = this.currentData.schedule.filter(i => i.done).length;
        this.elements.dayProgress.classList.toggle('hidden', total === 0);
        this.elements.dayProgressFill.style.width = total ? (done / total * 100) + '%' : '0%';
        this.elements.dayProgressText.textContent = done + '/' + total;
    }

    showHistoryModal(plans, onPlanClick) {
        this.onHistoryPlanClick = onPlanClick;
        this.elements.historyListContainer.innerHTML = '';
        this.renderHistoryList(plans);
        this.elements.historyModal.classList.remove('hidden');
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

    hideHistoryModal() {
        this.elements.historyModal.classList.add('hidden');
    }

    showWeekModal() {
        this.elements.weekModal.classList.remove('hidden');
    }

    hideWeekModal() {
        this.elements.weekModal.classList.add('hidden');
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
        
        this.speech = new SpeechService(
            (text) => this.ui.appendBraindumpText(text),
            () => this.ui.setMicActive(false)
        );

        this.init();
    }

    init() {
        this.ui.onPlanEdit = (planId, newData) => this.handlePlanEdit(planId, newData);
        this.ui.onPlanToggle = (planId, index, done) => this.handlePlanToggle(planId, index, done);
        this.ui.onRepeatToggle = (enabled) => this.handleRepeatToggle(enabled);

        this.ui.elements.repeatToggle.addEventListener('click', () => {
            const enabled = !this.ui.elements.repeatToggle.classList.contains('active');
            if (this.ui.onRepeatToggle) this.ui.onRepeatToggle(enabled);
        });

        this.ui.elements.temperatureInput.addEventListener('input', (e) => {
            this.ui.elements.temperatureValue.textContent = e.target.value;
        });

        this.ui.bindEvents({
            onAuthClick: () => this.handleAuth(),
            onSettingsClick: () => this.ui.showModal(this.apiKey, Storage.getModel(), Storage.getTemperature()),
            onCloseModal: () => this.ui.hideModal(),
            onSaveApiKey: () => this.handleSaveApiKey(),
            onOrganize: () => this.handleOrganize(),
            onReset: () => this.ui.resetView(),
            onHistoryClick: () => this.handleHistoryClick(),
            onCloseHistoryModal: () => { this.historyModalOpen = false; this.ui.hideHistoryModal(); },
            onClearHistory: () => this.handleClearHistory(),
            onMicClick: () => this.handleMic(),
            onWeekClick: () => this.handleWeekClick(),
            onCloseWeekModal: () => { this.weekModalOpen = false; this.ui.hideWeekModal(); },
            onWeekPrev: () => { this.weekOffset -= 1; this.renderWeek(); },
            onWeekNext: () => { this.weekOffset += 1; this.renderWeek(); }
        });

        if (!isFirebaseMocked && auth) {
            onAuthStateChanged(auth, (user) => {
                this.ui.updateAuthButton(!!user);
                if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
                this.plans = [];
                if (user) {
                    this.unsubscribe = Storage.subscribePlans((plans) => this.handlePlansUpdate(plans));
                }
            });
        }

        this.initPush();
        
        NotificationService.requestPermission();
    }

        initPush() {
        if (isFirebaseMocked || !messaging || !VAPID_KEY || VAPID_KEY === 'YOUR_VAPID_KEY') {
            console.warn('Push-уведомления отключены: не задан VAPID-ключ.');
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
        this.ui.setMicActive(true);
        this.speech.start();
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

    handleSaveApiKey() {
        const newKey = this.ui.getApiKeyInput();
        this.apiKey = newKey;
        Storage.saveApiKey(newKey);

        const newModel = this.ui.getModelInput();
        Storage.saveModel(newModel);
        this.api.modelName = newModel;

        const newTemperature = this.ui.getTemperatureInput();
        Storage.saveTemperature(newTemperature);
        this.api.temperature = newTemperature;

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
            this.ui.showModal(this.apiKey, Storage.getModel(), Storage.getTemperature());
            return;
        }

        this.ui.showLoader();

        try {
            const responseData = await this.api.generateScheduleAndRec(text, this.apiKey);
            
            const savedPlan = await Storage.savePlan({
                timestamp: Date.now(),
                prompt: text,
                data: responseData
            });

            this.ui.renderResults(responseData, savedPlan.id, false, null);
            NotificationService.scheduleNotifications(responseData.schedule);
            
        } catch (error) {
            console.error(error);
            this.ui.showError(error.message);
            this.ui.resetView();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
