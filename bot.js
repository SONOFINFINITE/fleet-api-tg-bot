require('dotenv').config();
const { Bot } = require('grammy');
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
const DATA_DIR = process.env.NODE_ENV === 'production' 
    ? '/opt/render/project/src/data'  // Путь на Render.com
    : path.join(__dirname, 'data');    // Локальный путь

const subscribersPath = path.join(DATA_DIR, 'subscribers.json');
log(`Путь к файлу подписчиков: ${subscribersPath}`);

// Создаем директорию для данных, если её нет
if (!fs.existsSync(DATA_DIR)) {
    log(`Создание директории для данных: ${DATA_DIR}`);
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        log('Директория успешно создана');
    } catch (error) {
        log(`Ошибка при создании директории: ${error.message}`, true);
        // Попробуем использовать временную директорию
        const tempDir = require('os').tmpdir();
        DATA_DIR = path.join(tempDir, 'fleet-bot-data');
        log(`Пробуем использовать временную директорию: ${DATA_DIR}`);
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// Создаем файл subscribers.json, если его нет
if (!fs.existsSync(subscribersPath)) {
    log('Создание файла subscribers.json');
    try {
        fs.writeFileSync(subscribersPath, JSON.stringify({ subscribers: [] }, null, 2));
        log('Файл subscribers.json успешно создан');
    } catch (error) {
        log(`Ошибка при создании файла: ${error.message}`, true);
    }
}

// Проверка наличия токена бота
if (!process.env.BOT_TOKEN) {
    log('Ошибка: Не установлен BOT_TOKEN', true);
    process.exit(1);
}

const bot = new Bot(process.env.BOT_TOKEN);
log('Бот инициализирован');

// Функция для получения разрешенных chat_id из переменных окружения
function getAllowedChatIds() {
    const chatIds = [];
    
    // Проверяем наличие каждой переменной окружения
    if (process.env.CHAT_ID_1) chatIds.push(Number(process.env.CHAT_ID_1));
    if (process.env.CHAT_ID_2) chatIds.push(Number(process.env.CHAT_ID_2));
    if (process.env.CHAT_ID_3) chatIds.push(Number(process.env.CHAT_ID_3));
    
    return chatIds;
}

async function fetchTopDrivers(endpoint) {
    try {
        log(`Запрос данных для endpoint: ${endpoint}`);
        const [topResponse, weekResponse, monthlyResponse] = await Promise.all([
            fetch(`https://fleet-api-server.onrender.com/top/money/${endpoint}`),
            fetch(`https://fleet-api-server.onrender.com/top/money/week`),
            fetch(`https://fleet-api-server.onrender.com/monthlybonus`)
        ]);
        
        log(`Статус ответа top: ${topResponse.status}, week: ${weekResponse.status}, monthly: ${monthlyResponse.status}`);
        // Проверяем статус ответов
        if (!topResponse.ok || !weekResponse.ok || !monthlyResponse.ok) {
            throw new Error(`HTTP error! status: ${topResponse.status}, ${weekResponse.status}, ${monthlyResponse.status}`);
        }
        
        // Получаем текст ответов
        const [topText, weekText, monthlyText] = await Promise.all([
            topResponse.text(),
            weekResponse.text(),
            monthlyResponse.text()
        ]);
        
        try {
            // Пытаемся распарсить JSON
            const topData = JSON.parse(topText);
            const weekData = JSON.parse(weekText);
            const monthlyData = JSON.parse(monthlyText);
            
            // Если запрашиваем недельные данные, возвращаем их как есть с месячным бонусом
            if (endpoint === 'week') {
                return {
                    ...topData,
                    monthlyBonus: monthlyData.monthlyBonus
                };
            }
            
            // Для дневных данных добавляем недельный и месячный бонусы
            return {
                ...topData,
                weeklyBonusSum: weekData.weeklyBonusSum,
                monthlyBonus: monthlyData.monthlyBonus
            };
        } catch (e) {
            log(`Ошибка парсинга JSON. Ответ сервера: ${topText}`, true);
            return null;
        }
    } catch (error) {
        log(`Ошибка при получении данных для ${endpoint}: ${error.message}`, true);
        return null;
    }
}

function formatTodayMessage(data) {
    const now = moment().tz('Europe/Moscow');
    const dateStr = now.format('D MMMM YYYY');
    const timeStr = now.format('HH:mm');

    
    let message = `*Топ Курьеров за ${dateStr} [${timeStr}]*\n*Парки Народный и Luxury courier*\n\n`;
    message += `*Недельный бонус: ${data.weeklyBonusSum}₽*\n\n`;
    message += `*Месячный бонус: ${data.monthlyBonus}*\n\n`;
    data.topList.forEach((driver, index) => {
        const driverId = driver.phone.slice(-5);
        const hours = Number(driver.hours.replace(',', '.')) || 0;
        const money = Number(driver.money) || 0;
        const orders = Number(driver.orders) || 0;
        const hourlyRate = hours > 0 ? Math.round(money / hours) : 0;

        message += `${index + 1}. Т79.${driverId} -${orders}з -${hours.toFixed(1)} ч -${money}₽ -${hourlyRate} ₽/ч\n`;
        
        if (index !== data.topList.length - 1) {
            message += '-----------------------------------\n';
        }
    });

    return message;
}

function formatWeekMessage(data) {
    const now = moment().tz('Europe/Moscow');
    // Устанавливаем понедельник как начало недели
    moment.updateLocale('ru', { week: { dow: 1 } }); // 1 = Понедельник
    const startOfWeek = now.clone().startOf('week'); // Понедельник
    const endOfWeek = startOfWeek.clone().add(6, 'days'); // Воскресенье
    const dateRange = `с ${startOfWeek.format('D MMMM')} по ${endOfWeek.format('D MMMM')}`;

    
    let message = `*Топ Курьеров за неделю ${dateRange}*\n*Парки Народный и Luxury courier*\n\n`;
    message += `*Недельный бонус: ${data.weeklyBonusSum}₽*\n\n`;

    data.topList.forEach((driver, index) => {
        const driverId = driver.phone.slice(-5);
        const hours = Number(driver.hours.replace(',', '.')) || 0;
        const money = Number(driver.money) || 0;
        const orders = Number(driver.orders) || 0;
        const hourlyRate = hours > 0 ? Math.round(money / hours) : 0;

        message += `${index + 1}. Т79.${driverId} -${orders}з -${hours.toFixed(1)} ч -${money}₽ -${hourlyRate} ₽/ч\n`;
        
        if (index !== data.topList.length - 1) {
            message += '-----------------------------------\n';
        }
    });

    return message;
}

function formatYesterdayMessage(data) {
    const now = moment().tz('Europe/Moscow');
    const date = now.subtract(1, 'days');
    const dateStr = date.format('D MMMM YYYY');
    const timeStr = now.format('HH:mm');

    let message = `*Топ Курьеров за ${dateStr}*\n*Парки Народный и Luxury courier*\n\n`;
    message += `*Недельный бонус: ${data.weeklyBonusSum}₽*\n\n`;
    message += `*Месячный бонус: ${data.monthlyBonus}₽*\n\n`;

    data.topList.forEach((driver, index) => {
        const driverId = driver.phone.slice(-5);
        const hours = Number(driver.hours.replace(',', '.')) || 0;
        const money = Number(driver.money) || 0;
        const orders = Number(driver.orders) || 0;
        const hourlyRate = hours > 0 ? Math.round(money / hours) : 0;

        message += `${index + 1}. Т79.${driverId} -${orders}з -${hours.toFixed(1)} ч -${money}₽ -${hourlyRate} ₽/ч\n`;
        
        if (index !== data.topList.length - 1) {
            message += '-----------------------------------\n';
        }
    });

    return message;
}

async function sendTodayStatistics() {
    log('Начало отправки статистики');
    const data = await fetchTopDrivers('today');
    if (data) {
        const message = formatTodayMessage(data);
        const allowedChatIds = getAllowedChatIds();
        log(`Отправка статистики ${allowedChatIds.length} получателям`);
        
        for (const chatId of allowedChatIds) {
            try {
                log(`Отправка сообщения в чат ${chatId}`);
                await bot.api.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown'
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

async function sendYesterdayStatistics() {
    log('Начало отправки статистики');
    const data = await fetchTopDrivers('yesterday');
    if (data) {
        const message = formatYesterdayMessage(data);
        const allowedChatIds = getAllowedChatIds();
        log(`Отправка статистики ${allowedChatIds.length} получателям`);
        
        for (const chatId of allowedChatIds) {
            try {
                log(`Отправка сообщения в чат ${chatId}`);
                await bot.api.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown'
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

async function sendWeekStatistics() {
    log('Начало отправки статистики');
    const data = await fetchTopDrivers('week');
    if (data) {
        const message = formatWeekMessage(data);
        const allowedChatIds = getAllowedChatIds();
        log(`Отправка статистики ${allowedChatIds.length} получателям`);
        
        for (const chatId of allowedChatIds) {
            try {
                log(`Отправка сообщения в чат ${chatId}`);
                await bot.api.sendMessage(chatId, message, { 
                    parse_mode: 'Markdown'
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

// Настройка расписания (время UTC для соответствия МСК)
const todayStatsSchedules = [
    '00 5 * * *',  // 08:05 MSK
    '00 9 * * *',  // 12:00 MSK
    '00 13 * * *', // 16:00 MSK
    '00 17 * * *', // 20:00 MSK
];
const yesterdayStatsSchedules = [
    '15 5 * * *',  // 08:05 MSK

];
log('Настройка расписания отправки статистики (UTC -> MSK):');
todayStatsSchedules.forEach(cronTime => {
    log(`Добавлено расписание UTC: ${cronTime} (MSK: +3 часа)`);
    const job = schedule.scheduleJob(cronTime, () => {
        log(`Запуск отправки статистики по расписанию: ${cronTime} UTC`);
        sendTodayStatistics();
    });
    if (job) {
        const nextUTC = job.nextInvocation();
        const nextMSK = moment(nextUTC).tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
        log(`Следующий запуск для ${cronTime}: UTC=${nextUTC}, MSK=${nextMSK}`);
    } else {
        log(`Ошибка при создании расписания для ${cronTime}`, true);
    }
});
yesterdayStatsSchedules.forEach(cronTime => {
    log(`Добавлено расписание UTC: ${cronTime} (MSK: +3 часа)`);
    const job = schedule.scheduleJob(cronTime, () => {
        log(`Запуск отправки статистики по расписанию: ${cronTime} UTC`);
        sendYesterdayStatistics();
    });
    if (job) {
        const nextUTC = job.nextInvocation();
        const nextMSK = moment(nextUTC).tz('Europe/Moscow').format('YYYY-MM-DD HH:mm:ss');
        log(`Следующий запуск для ${cronTime}: UTC=${nextUTC}, MSK=${nextMSK}`);
    } else {
        log(`Ошибка при создании расписания для ${cronTime}`, true);
    }
});

// Обработчик команды /start
bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const allowedChatIds = getAllowedChatIds();

    if (allowedChatIds.includes(chatId)) {
        await ctx.reply('Добро пожаловать! Используйте команды /tday для статистики за сегодня и /yday для статистики за вчера.');
    } else {
        await ctx.reply('У вас нет доступа к этому боту.');
    }
});

// Обработчик команды /tday (статистика за сегодня)
bot.command('tday', async (ctx) => {
    const chatId = ctx.chat.id;
    const allowedChatIds = getAllowedChatIds();

    if (!allowedChatIds.includes(chatId)) {
        await ctx.reply('У вас нет доступа к этой функции.');
        return;
    }

    try {
        const data = await fetchTopDrivers('today');
        if (data) {
            const message = formatTodayMessage(data);
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('Извините, сервер статистики временно недоступен. Попробуйте через несколько минут.');
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики. Пожалуйста, попробуйте позже.');
    }
});

// Обработчик команды /yday (статистика за вчера)
bot.command('yday', async (ctx) => {
    const chatId = ctx.chat.id;
    const allowedChatIds = getAllowedChatIds();

    if (!allowedChatIds.includes(chatId)) {
        await ctx.reply('У вас нет доступа к этой функции.');
        return;
    }

    try {
        const data = await fetchTopDrivers('yesterday');
        if (data) {
            const message = formatYesterdayMessage(data);
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('Извините, сервер статистики временно недоступен. Попробуйте через несколько минут.');
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики. Пожалуйста, попробуйте позже.');
    }
});

bot.command('week', async (ctx) => {
    const chatId = ctx.chat.id;
    const allowedChatIds = getAllowedChatIds();

    if (!allowedChatIds.includes(chatId)) {
        await ctx.reply('У вас нет доступа к этой функции.');
        return;
    }

    try {
        const data = await fetchTopDrivers('week');
        if (data) {
            const message = formatWeekMessage(data);
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('Извините, сервер статистики временно недоступен. Попробуйте через несколько минут.');
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса статистики:', error);
        await ctx.reply('Произошла ошибка при получении статистики. Пожалуйста, попробуйте позже.');
    }
});

// Запуск бота
bot.start();
console.log('Бот запущен и ожидает сообщений...'); 