require('dotenv').config();
const { Bot, Keyboard } = require('grammy');
const schedule = require('node-schedule');
const fetch = require('node-fetch');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Функция для логирования с timestamp
function log(message, error = false) {
    const timestamp = moment().tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
    const logMessage = `[${timestamp}] ${message}`;
    if (error) {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }
}

// Создаем Express приложение
const app = express();
const port = process.env.PORT || 3000;

// URL нашего приложения на render.com
const APP_URL = process.env.RENDER_EXTERNAL_URL;
log(`APP_URL: ${APP_URL}`);

// Добавляем простой эндпоинт для проверки работоспособности
app.get('/', (req, res) => {
    log('Получен GET запрос к корневому эндпоинту');
    res.send('Бот работает!');
});

// Добавляем эндпоинт для проверки здоровья
app.get('/health', (req, res) => {
    log('Получен GET запрос к эндпоинту /health');
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Добавляем эндпоинт для проверки времени
app.get('/time', (req, res) => {
    const now = moment().tz('Europe/Moscow');
    const serverTime = {
        moscow: now.format('YYYY-MM-DD HH:mm:ss'),
        utc: moment().utc().format('YYYY-MM-DD HH:mm:ss'),
        server: new Date().toISOString(),
        timezone: process.env.TZ || 'system default'
    };
    log(`Запрос времени сервера: ${JSON.stringify(serverTime)}`);
    res.json(serverTime);
});

// Функция для самопинга
async function keepAlive() {
    if (APP_URL) {
        try {
            log('Выполняется самопинг...');
            const response = await fetch(`${APP_URL}/health`);
            const data = await response.json();
            log(`Самопинг успешен: ${data.timestamp}`);
        } catch (error) {
            log(`Ошибка самопинга: ${error.message}`, true);
        }
    }
}

// Запускаем веб-сервер
app.listen(port, () => {
    log(`Веб-сервер запущен на порту ${port}`);
    
    if (APP_URL) {
        setInterval(keepAlive, 2 * 60 * 1000);
        log('Самопинг активирован (интервал: 2 минуты)');
    }
});

// Установка русской локализации
moment.locale('ru');
log('Установлена русская локализация');

// Путь к файлу с подписчиками
const subscribersPath = path.join(process.env.DATA_DIR || __dirname, 'subscribers.json');
log(`Путь к файлу подписчиков: ${subscribersPath}`);

// Создаем директорию для данных, если её нет
const dataDir = path.dirname(subscribersPath);
if (!fs.existsSync(dataDir)) {
    log(`Создание директории для данных: ${dataDir}`);
    fs.mkdirSync(dataDir, { recursive: true });
}

// Создаем файл subscribers.json, если его нет
if (!fs.existsSync(subscribersPath)) {
    log('Создание файла subscribers.json');
    fs.writeFileSync(subscribersPath, JSON.stringify({ subscribers: [] }, null, 2));
}

// Функция для чтения списка подписчиков
function getSubscribers() {
    try {
        const data = fs.readFileSync(subscribersPath, 'utf8');
        const subscribers = JSON.parse(data).subscribers;
        log(`Загружено ${subscribers.length} подписчиков`);
        return subscribers;
    } catch (error) {
        log(`Ошибка при чтении списка подписчиков: ${error.message}`, true);
        return [];
    }
}

// Функция для сохранения списка подписчиков
function saveSubscribers(subscribers) {
    try {
        fs.writeFileSync(subscribersPath, JSON.stringify({ subscribers }, null, 2));
        log(`Сохранено ${subscribers.length} подписчиков`);
    } catch (error) {
        log(`Ошибка при сохранении списка подписчиков: ${error.message}`, true);
    }
}

// Проверка наличия токена бота
if (!process.env.BOT_TOKEN) {
    log('Ошибка: Не установлен BOT_TOKEN', true);
    process.exit(1);
}

const bot = new Bot(process.env.BOT_TOKEN);
log('Бот инициализирован');

// Создаем клавиатуру для неподписанных пользователей
const subscribeKeyboard = new Keyboard()
    .text("✅ Подписаться на уведомления")
    .resized();

// Создаем клавиатуру для подписанных пользователей
const subscribedKeyboard = new Keyboard()
    .text("📊 Статистика за сегодня")
    .text("📈 Статистика за вчера")
    .row()
    .text("❌ Отписаться от уведомлений")
    .resized();

async function fetchTopDrivers(endpoint) {
    try {
        log(`Запрос данных для endpoint: ${endpoint}`);
        const response = await fetch(`https://fleet-api-server.onrender.com/top/money/${endpoint}`);
        
        log(`Статус ответа: ${response.status}`);
        // Проверяем статус ответа
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Получаем текст ответа для логирования в случае ошибки
        const text = await response.text();
        log(`Получен ответ длиной ${text.length} символов`);
        
        try {
            // Пытаемся распарсить JSON
            const data = JSON.parse(text);
            log(`Успешно получены данные: ${data.length} записей`);
            return data;
        } catch (e) {
            log(`Ошибка парсинга JSON. Ответ сервера: ${text}`, true);
            return null;
        }
    } catch (error) {
        log(`Ошибка при получении данных для ${endpoint}: ${error.message}`, true);
        return null;
    }
}

function formatMessage(data, isYesterday = false) {
    const now = moment().tz('Europe/Moscow');
    const date = isYesterday ? now.subtract(1, 'days') : now;
    const dateStr = date.format('D MMMM YYYY');
    const timeStr = now.format('HH:mm');

    let message = isYesterday 
        ? `*Топ Курьеров за ${dateStr}*\n*Парки Народный и Luxury courier*\n\n`
        : `*Топ Курьеров за ${dateStr} [${timeStr}]*\n*Парки Народный и Luxury courier*\n\n`;

    data.forEach((driver, index) => {
        const driverId = driver.phone.slice(-5);
        const hours = Number(driver.hours.replace(',', '.')) || 0;
        const money = Number(driver.money) || 0;
        const orders = Number(driver.orders) || 0;
        const hourlyRate = hours > 0 ? Math.round(money / hours) : 0;

        message += `${index + 1}. Т79.${driverId} - ${orders} з - ${hours} ч - ${money} ₽ - ${hourlyRate} ₽/ч \n`;
    });

    return message;
}

async function sendStatistics() {
    log('Начало отправки статистики');
    const data = await fetchTopDrivers('today');
    if (data) {
        const message = formatMessage(data);
        const subscribers = getSubscribers();
        log(`Отправка статистики ${subscribers.length} подписчикам`);
        
        for (const chatId of subscribers) {
            try {
                log(`Отправка сообщения в чат ${chatId}`);
                await bot.api.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: subscribedKeyboard
                });
                log(`Сообщение успешно отправлено в чат ${chatId}`);
            } catch (error) {
                log(`Ошибка при отправке сообщения в чат ${chatId}: ${error.message}`, true);
            }
        }
    } else {
        log('Нет данных для отправки статистики', true);
    }
}

// Настройка расписания (время МСК)
process.env.TZ = 'Europe/Moscow';

// Функция для проверки времени отправки
function shouldSendStatistics() {
    const now = moment().tz('Europe/Moscow');
    const currentHour = now.hour();
    const currentMinute = now.minute();

    // Массив времени отправки [час, минута]
    const schedules = [
        [8, 0],   // 08:00
        [12, 0],  // 12:00
        [18, 5],  // 18:00
        [20, 0],  // 20:00
        [23, 55]  // 23:55
    ];

    // Проверяем, совпадает ли текущее время с одним из запланированных
    return schedules.some(([hour, minute]) => 
        currentHour === hour && currentMinute === minute
    );
}

// Функция проверки и отправки статистики
async function checkAndSendStatistics() {
    const now = moment().tz('Europe/Moscow');
    log(`Проверка времени отправки: ${now.format('YYYY-MM-DD HH:mm:ss')}`);

    if (shouldSendStatistics()) {
        log('Наступило время отправки статистики');
        await sendStatistics();
    }
}

// Запускаем проверку каждую минуту
log('Запуск системы расписания');
setInterval(checkAndSendStatistics, 60 * 1000); // Проверка каждую минуту

// Запускаем первую проверку сразу
checkAndSendStatistics();

// Добавляем тестовый запуск через 2 минуты
setTimeout(async () => {
    log('Выполняется тестовый запуск');
    await sendStatistics();
}, 2 * 60 * 1000);

// Обработчик команды /start
bot.command('start', async (ctx) => {
    const subscribers = getSubscribers();
    const chatId = ctx.chat.id;
    const isSubscribed = subscribers.includes(chatId);

    await ctx.reply(
        'Добро пожаловать! Используйте кнопки ниже для управления подпиской на статистику.',
        { 
            reply_markup: isSubscribed ? subscribedKeyboard : subscribeKeyboard 
        }
    );
});

// Обработчик кнопки статистики за сегодня
bot.hears('📊 Статистика за сегодня', async (ctx) => {
    try {
        const data = await fetchTopDrivers('today');
        if (data) {
            const message = formatMessage(data);
            await ctx.reply(message, { 
                parse_mode: 'Markdown',
                reply_markup: subscribedKeyboard
            });
        } else {
            await ctx.reply('Извините, сервер статистики временно недоступен. Попробуйте через несколько минут.', {
                reply_markup: subscribedKeyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики. Пожалуйста, попробуйте позже.', {
            reply_markup: subscribedKeyboard
        });
    }
});

// Обработчик кнопки статистики за вчера
bot.hears('📈 Статистика за вчера', async (ctx) => {
    try {
        const data = await fetchTopDrivers('yesterday');
        if (data) {
            const message = formatMessage(data, true);
            await ctx.reply(message, { 
                parse_mode: 'Markdown',
                reply_markup: subscribedKeyboard
            });
        } else {
            await ctx.reply('Извините, сервер статистики временно недоступен. Попробуйте через несколько минут.', {
                reply_markup: subscribedKeyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики. Пожалуйста, попробуйте позже.', {
            reply_markup: subscribedKeyboard
        });
    }
});

// Обработчик кнопки подписки
bot.hears('✅ Подписаться на уведомления', (ctx) => {
    const subscribers = getSubscribers();
    const chatId = ctx.chat.id;

    if (!subscribers.includes(chatId)) {
        subscribers.push(chatId);
        saveSubscribers(subscribers);
        ctx.reply('Вы успешно подписались на уведомления! 👍\nТеперь вам доступна расширенная статистика:', {
            reply_markup: subscribedKeyboard
        });
    } else {
        ctx.reply('Вы уже подписаны на уведомления', {
            reply_markup: subscribedKeyboard
        });
    }
});

// Обработчик кнопки отписки
bot.hears('❌ Отписаться от уведомлений', (ctx) => {
    const subscribers = getSubscribers();
    const chatId = ctx.chat.id;
    const index = subscribers.indexOf(chatId);

    if (index !== -1) {
        subscribers.splice(index, 1);
        saveSubscribers(subscribers);
        ctx.reply('Вы успешно отписались от уведомлений', {
            reply_markup: subscribeKeyboard
        });
    } else {
        ctx.reply('Вы не были подписаны на уведомления', {
            reply_markup: subscribeKeyboard
        });
    }
});

// Запуск бота
bot.start();
console.log('Бот запущен и ожидает сообщений...'); 