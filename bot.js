require('dotenv').config();
const { Bot, Keyboard } = require('grammy');
const schedule = require('node-schedule');
const fetch = require('node-fetch');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Создаем Express приложение
const app = express();
const port = process.env.PORT || 3000;

// URL нашего приложения на render.com
const APP_URL = process.env.RENDER_EXTERNAL_URL;

// Добавляем простой эндпоинт для проверки работоспособности
app.get('/', (req, res) => {
    res.send('Бот работает!');
});

// Добавляем эндпоинт для проверки здоровья
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Функция для самопинга
async function keepAlive() {
    if (APP_URL) {
        try {
            const response = await fetch(`${APP_URL}/health`);
            const data = await response.json();
            console.log('Self-ping successful:', data.timestamp);
        } catch (error) {
            console.error('Self-ping failed:', error.message);
        }
    }
}

// Запускаем веб-сервер
app.listen(port, () => {
    console.log(`Веб-сервер запущен на порту ${port}`);
    
    // Запускаем самопинг каждые 10 минут
    if (APP_URL) {
        setInterval(keepAlive, 2 * 60 * 1000);
        console.log('Самопинг активирован');
    }
});

// Установка русской локализации
moment.locale('ru');

// Путь к файлу с подписчиками
const subscribersPath = path.join(process.env.DATA_DIR || __dirname, 'subscribers.json');

// Создаем директорию для данных, если её нет
const dataDir = path.dirname(subscribersPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Создаем файл subscribers.json, если его нет
if (!fs.existsSync(subscribersPath)) {
    fs.writeFileSync(subscribersPath, JSON.stringify({ subscribers: [] }, null, 2));
}

// Функция для чтения списка подписчиков
function getSubscribers() {
    try {
        const data = fs.readFileSync(subscribersPath, 'utf8');
        return JSON.parse(data).subscribers;
    } catch (error) {
        return [];
    }
}

// Функция для сохранения списка подписчиков
function saveSubscribers(subscribers) {
    fs.writeFileSync(subscribersPath, JSON.stringify({ subscribers }, null, 2));
}

// Проверка наличия токена бота
if (!process.env.BOT_TOKEN) {
    console.error('Ошибка: Не установлен BOT_TOKEN');
    process.exit(1);
}

const bot = new Bot(process.env.BOT_TOKEN);

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
        const response = await fetch(`https://fleet-api-server.onrender.com/top/money/${endpoint}`);
        
        // Проверяем статус ответа
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Получаем текст ответа для логирования в случае ошибки
        const text = await response.text();
        
        try {
            // Пытаемся распарсить JSON
            const data = JSON.parse(text);
            return data;
        } catch (e) {
            console.error('Ошибка парсинга JSON. Ответ сервера:', text);
            return null;
        }
    } catch (error) {
        console.error(`Ошибка при получении данных для ${endpoint}:`, error.message);
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
    const data = await fetchTopDrivers('today');
    if (data) {
        const message = formatMessage(data);
        const subscribers = getSubscribers();
        
        for (const chatId of subscribers) {
            try {
                await bot.api.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown',
                    reply_markup: subscribedKeyboard
                });
            } catch (error) {
                console.error(`Ошибка при отправке сообщения в чат ${chatId}:`, error);
            }
        }
    }
}

// Настройка расписания (время МСК)
const schedules = ['00 8 * * *', '00 12 * * *', '40 17 * * *', '00 20 * * *', '55 23 * * *'];

schedules.forEach(cronTime => {
    schedule.scheduleJob(cronTime, sendStatistics);
});

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