import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
let app, auth, db;
if (!isFirebaseMocked) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
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

    static async updatePlan(planId, newData) {
        if (!isFirebaseMocked && auth && auth.currentUser) {
            const docRef = doc(db, `users/${auth.currentUser.uid}/plans`, planId);
            await updateDoc(docRef, { data: newData });
        } else {
            const plans = await this.getPlans();
            const index = plans.findIndex(p => p.id === planId);
            if (index !== -1) {
                plans[index].data = newData;
                localStorage.setItem('butler_plans', JSON.stringify(plans));
            }
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
}

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
        this.modelName = 'gemini-2.5-flash';
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
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7 }
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        let textOutput = data.candidates[0].content.parts[0].text;
        textOutput = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(textOutput);
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
            recType: document.getElementById('recType'),
            recTitle: document.getElementById('recTitle'),
            recDescription: document.getElementById('recDescription'),
            apiKeyModal: document.getElementById('apiKeyModal'),
            apiKeyInput: document.getElementById('apiKeyInput'),
            saveApiBtn: document.getElementById('saveApiBtn'),
            closeApiBtn: document.getElementById('closeApiBtn'),
            inputSection: document.querySelector('.input-section'),
            historyBtn: document.getElementById('historyBtn'),
            historyModal: document.getElementById('historyModal'),
            historyListContainer: document.getElementById('historyListContainer'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            closeHistoryBtn: document.getElementById('closeHistoryBtn')
        };
        this.onPlanEdit = null;
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

    showModal(currentKey) {
        this.elements.apiKeyInput.value = currentKey;
        this.elements.apiKeyModal.classList.remove('hidden');
    }

    hideModal() {
        this.elements.apiKeyModal.classList.add('hidden');
    }

    getApiKeyInput() {
        return this.elements.apiKeyInput.value.trim();
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

    renderResults(data, planId) {
        this.currentPlanId = planId;
        this.currentData = data;
        
        this.elements.scheduleList.innerHTML = '';
        data.schedule.forEach((item, index) => {
            const li = document.createElement('li');
            
            const timeInput = document.createElement('input');
            timeInput.className = 'time editable';
            timeInput.value = item.time;
            
            const taskInput = document.createElement('input');
            taskInput.className = 'task editable';
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
            
            li.appendChild(timeInput);
            li.appendChild(taskInput);
            this.elements.scheduleList.appendChild(li);
        });

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

    showHistoryModal(plans, onPlanClick) {
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
                
                itemDiv.addEventListener('click', () => onPlanClick(plan));
                
                this.elements.historyListContainer.appendChild(itemDiv);
            });
        }

        this.elements.historyModal.classList.remove('hidden');
    }

    hideHistoryModal() {
        this.elements.historyModal.classList.add('hidden');
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

        this.ui.bindEvents({
            onAuthClick: () => this.handleAuth(),
            onSettingsClick: () => this.ui.showModal(this.apiKey),
            onCloseModal: () => this.ui.hideModal(),
            onSaveApiKey: () => this.handleSaveApiKey(),
            onOrganize: () => this.handleOrganize(),
            onReset: () => this.ui.resetView(),
            onHistoryClick: () => this.handleHistoryClick(),
            onCloseHistoryModal: () => this.ui.hideHistoryModal(),
            onClearHistory: () => this.handleClearHistory(),
            onMicClick: () => this.handleMic()
        });

        if (!isFirebaseMocked && auth) {
            onAuthStateChanged(auth, (user) => {
                this.ui.updateAuthButton(!!user);
            });
        }
        
        NotificationService.requestPermission();
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
        const plans = await Storage.getPlans();
        this.ui.showHistoryModal(plans, (plan) => this.handleLoadHistoricalPlan(plan));
    }

    async handleClearHistory() {
        await Storage.clearPlans();
        this.ui.showHistoryModal([], () => {});
    }

    handleLoadHistoricalPlan(plan) {
        this.ui.hideHistoryModal();
        this.ui.showLoader();
        setTimeout(() => {
            this.ui.renderResults(plan.data, plan.id);
            NotificationService.scheduleNotifications(plan.data.schedule);
        }, 300);
    }

    handleSaveApiKey() {
        const newKey = this.ui.getApiKeyInput();
        this.apiKey = newKey;
        Storage.saveApiKey(newKey);
        this.ui.hideModal();
    }

    async handlePlanEdit(planId, newData) {
        if (planId) {
            await Storage.updatePlan(planId, newData);
            NotificationService.scheduleNotifications(newData.schedule);
        }
    }

    async handleOrganize() {
        const text = this.ui.getBraindumpText();
        
        if (!text) {
            this.ui.showError('Пожалуйста, напишите что-нибудь в поле ввода.');
            return;
        }
        
        if (!this.apiKey) {
            this.ui.showModal(this.apiKey);
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

            this.ui.renderResults(responseData, savedPlan.id);
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
