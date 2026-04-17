import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cron from 'node-cron';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/database.js';
import { Wallet } from './models/Wallet.js';
import { BalanceHistory } from './models/BalanceHistory.js';
import { BotSubscriber } from './models/BotSubscriber.js';
import { checkBalance, formatBalance, formatBalanceUSD, convertToUSD } from './services/balanceChecker.js';

// Загрузка переменных окружения
// В ESM `dotenv.config()` без path берет .env из process.cwd().
// PM2 может запускать процесс не из корня проекта, поэтому указываем путь явно.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Проверка наличия токена
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Ошибка: TELEGRAM_BOT_TOKEN не установлен в .env файле');
  process.exit(1);
}

// Создание экземпляра бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/** Команды для меню Telegram (кнопка «Меню» и подсказка при вводе «/») */
const BOT_COMMANDS = [
  { command: 'start', description: 'Справка и список команд' },
  { command: 'addwallet', description: 'Добавить кошелёк в базу' },
  { command: 'addwallets', description: 'Массовый импорт кошельков из XLSX' },
  { command: 'wallets', description: 'Кошельки с балансом больше $100' },
  { command: 'checkwallet', description: 'Проверить один кошелёк по адресу' },
  { command: 'checkbalance', description: 'Проверить балансы всех кошельков' }
];

const syncTelegramCommandMenu = async () => {
  try {
    await bot.setMyCommands(BOT_COMMANDS, { scope: { type: 'default' } });
  } catch (err) {
    console.error('⚠️ setMyCommands:', err.message || err);
  }
  try {
    await bot.setChatMenuButton({
      menu_button: JSON.stringify({ type: 'commands' })
    });
  } catch (err) {
    console.error('⚠️ setChatMenuButton:', err.message || err);
  }
};

syncTelegramCommandMenu();

// Подключение к MongoDB
connectDB();

/**
 * Форматирование больших чисел с разделителями и сокращениями
 */
const formatLargeNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) {
    return '0';
  }
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  // Для чисел больше миллиарда - используем сокращение B
  if (absNum >= 1000000000) {
    return `${sign}${(absNum / 1000000000).toFixed(2)}B`;
  }
  
  // Для чисел больше миллиона - используем сокращение M
  if (absNum >= 1000000) {
    return `${sign}${(absNum / 1000000).toFixed(2)}M`;
  }
  
  // Для чисел больше тысячи - используем сокращение K
  if (absNum >= 1000) {
    return `${sign}${(absNum / 1000).toFixed(2)}K`;
  }
  
  // Для меньших чисел - просто форматируем с разделителями тысяч
  return `${sign}${absNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Форматирование числа с разделителями тысяч (для точного отображения)
 */
const formatNumberWithCommas = (num) => {
  if (num === null || num === undefined || isNaN(num)) {
    return '0.00';
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Вычисление времени до следующей автоматической проверки (6:00 или 15:00 по МСК)
 */
const getTimeUntilNextCheck = () => {
  const now = new Date();
  
  // Получаем текущее время в МСК
  const moscowTimeStr = now.toLocaleString('en-US', { 
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  // Парсим час и минуту из строки (формат: "HH:MM")
  const timeParts = moscowTimeStr.split(':');
  const currentHour = parseInt(timeParts[0] || '0', 10);
  const currentMinute = parseInt(timeParts[1] || '0', 10);
  
  // Определяем следующее время проверки
  let nextCheckHour, nextCheckMinute;
  let addDays = 0;
  
  if (currentHour < 6 || (currentHour === 6 && currentMinute === 0)) {
    // До 6:00 - следующая проверка сегодня в 6:00
    nextCheckHour = 6;
    nextCheckMinute = 0;
  } else if (currentHour < 15 || (currentHour === 15 && currentMinute === 0)) {
    // Между 6:00 и 15:00 - следующая проверка сегодня в 15:00
    nextCheckHour = 15;
    nextCheckMinute = 0;
  } else {
    // После 15:00 - следующая проверка завтра в 6:00
    nextCheckHour = 6;
    nextCheckMinute = 0;
    addDays = 1;
  }
  
  // Создаем объект времени следующей проверки в UTC
  // МСК = UTC+3, поэтому 6:00 МСК = 3:00 UTC, 15:00 МСК = 12:00 UTC
  const nextCheckUTC = new Date(now);
  nextCheckUTC.setUTCDate(nextCheckUTC.getUTCDate() + addDays);
  
  if (nextCheckHour === 6) {
    nextCheckUTC.setUTCHours(3, 0, 0, 0); // 6:00 МСК = 3:00 UTC
  } else {
    nextCheckUTC.setUTCHours(12, 0, 0, 0); // 15:00 МСК = 12:00 UTC
  }
  
  // Если следующая проверка уже прошла, переносим на завтра 6:00
  if (nextCheckUTC <= now) {
    nextCheckUTC.setUTCDate(nextCheckUTC.getUTCDate() + 1);
    nextCheckUTC.setUTCHours(3, 0, 0, 0);
  }
  
  // Вычисляем разницу
  const diff = nextCheckUTC - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  // Форматируем время следующей проверки
  const nextCheckTime = nextCheckUTC.toLocaleString('ru-RU', { 
    timeZone: 'Europe/Moscow', 
    hour: '2-digit', 
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
  
  return {
    hours,
    minutes,
    nextCheckTime
  };
};

/** Сохраняет chat_id для рассылки после автопроверки (всем, кто пользовался ботом). */
const registerBotSubscriber = async (msg) => {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const chatId = msg.chat.id;
    const from = msg.from;
    await BotSubscriber.findOneAndUpdate(
      { chatId },
      {
        $set: {
          chatType: msg.chat.type || 'private',
          username: from?.username || '',
          firstName: from?.first_name || '',
          lastActiveAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('❌ registerBotSubscriber:', e.message || e);
  }
};

const normalizeCell = (value) => String(value ?? '').trim();

const toValidUserId = (value) => {
  const parsed = Number.parseInt(normalizeCell(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await registerBotSubscriber(msg);

  await bot.sendMessage(
    chatId,
    `📋 Доступные команды:\n\n` +
    `/start — справка\n` +
    `/addwallet — добавить кошелёк\n` +
    `/addwallets — массово загрузить кошельки из XLSX\n` +
    `/wallets — кошельки с балансом > $100\n` +
    `/checkwallet — проверить один кошелёк (адрес из базы)\n` +
    `/checkbalance — проверить все кошельки\n\n` +
    `💡 Список команд также в меню чата (кнопка «Меню» или ввод «/»).`
  );
});

// Обработка команды /addwallet - добавление кошелька
bot.onText(/\/addwallet/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await registerBotSubscriber(msg);

  if (mongoose.connection.readyState !== 1) {
    await bot.sendMessage(chatId, '⚠️ База данных недоступна. Проверьте подключение к MongoDB.');
    return;
  }

  await bot.sendMessage(
    chatId,
    '📝 Добавление нового кошелька\n\n' +
    'Отправьте данные в следующем формате (каждое значение с новой строки):\n\n' +
    '📁 Проект\n' +
    '👤 User ID\n' +
    '📝 Алиас\n' +
    '💼 Адрес\n\n' +
    'Пример:\n' +
    'Unlim\n' +
    '164501\n' +
    'Finassets USDT_TRC\n' +
    'TSsX76Who8D36fFoBKLSxihkX3CWwBNQcB'
  );

  // Сохраняем состояние ожидания данных
  bot.once('message', async (responseMsg) => {
    if (responseMsg.chat.id !== chatId) return;
    if (responseMsg.text && responseMsg.text.startsWith('/')) return;

    try {
      const rawText = typeof responseMsg.text === 'string' ? responseMsg.text : '';
      if (!rawText) {
        await bot.sendMessage(
          chatId,
          '❌ Ожидался текст с 4 строками (проект, User ID, алиас, адрес).\n' +
          'Пожалуйста, запустите /addwallet и отправьте данные текстом.'
        );
        return;
      }

      const lines = rawText.split('\n').map(line => line.trim()).filter(line => line);
      
      if (lines.length < 4) {
        await bot.sendMessage(chatId, '❌ Недостаточно данных. Нужно 4 строки: проект, User ID, алиас, адрес.');
        return;
      }

      const [project, user_id, alias, wallet_destination] = lines;

      if (!project || project.length === 0) {
        await bot.sendMessage(chatId, '❌ Проект не может быть пустым');
        return;
      }

      if (isNaN(parseInt(user_id))) {
        await bot.sendMessage(chatId, '❌ User ID должен быть числом');
        return;
      }

      if (!wallet_destination || wallet_destination.length === 0) {
        await bot.sendMessage(chatId, '❌ Адрес кошелька не может быть пустым');
        return;
      }

      const wallet = new Wallet({
        project: project.trim(),
        user_id: parseInt(user_id),
        alias: alias ? alias.trim() : '',
        wallet_destination: wallet_destination.trim()
      });

      await wallet.save();
      console.log(`✅ Кошелек добавлен: ${wallet._id} для user_id ${user_id}`);

      await bot.sendMessage(
        chatId,
        `✅ Кошелек успешно добавлен!\n\n` +
        `📁 Проект: ${wallet.project}\n` +
        `👤 User ID: ${wallet.user_id}\n` +
        `📝 Алиас: ${wallet.alias || 'не указан'}\n` +
        `💼 Адрес: ${wallet.wallet_destination}\n`

      );
    } catch (error) {
      console.error('❌ Ошибка при добавлении кошелька:', error);
      if (error.code === 11000) {
        await bot.sendMessage(chatId, '❌ Кошелек с таким адресом уже существует.');
      } else {
        await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
      }
    }
  });
});

// Массовая загрузка кошельков из xlsx
bot.onText(/\/addwallets/, async (msg) => {
  const chatId = msg.chat.id;
  await registerBotSubscriber(msg);

  await bot.sendMessage(
    chatId,
    '📥 Массовая загрузка кошельков\n\n' +
    'Отправьте файл .xlsx с 4 столбцами БЕЗ заголовка:\n' +
    '1) 📁 Проект\n' +
    '2) 👤 User ID\n' +
    '3) 📝 Алиас\n' +
    '4) 💼 Адрес\n\n' +
    'Пример строки:\n' +
    'Unlim | 164501 | Finassets USDT_TRC | TSsX76Who8D36fFoBKLSxihkX3CWwBNQcB'
  );
});

// Функция для отображения страницы кошельков
const showWalletsPage = async (chatId, page = 0, messageId = null) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await bot.sendMessage(chatId, '⚠️ База данных недоступна.');
      return;
    }

    const allWallets = await Wallet.find().sort({ createdAt: -1 });

    if (allWallets.length === 0) {
      await bot.sendMessage(chatId, '📭 В базе данных пока нет кошельков.\n\nИспользуйте /addwallet для добавления.');
      return;
    }

    // Оптимизация: получаем все последние балансы одним запросом через агрегацию
    const MIN_BALANCE = 100;
    const walletIds = allWallets.map(w => w._id);
    
    // Получаем последние балансы для всех кошельков одним запросом
    const lastBalances = await BalanceHistory.aggregate([
      { $match: { wallet_id: { $in: walletIds } } },
      { $sort: { checkedAt: -1 } },
      {
        $group: {
          _id: '$wallet_id',
          balance: { $first: '$balance' },
          previousBalance: { $first: '$previousBalance' },
          checkedAt: { $first: '$checkedAt' }
        }
      }
    ]);
    
    // Создаем Map для быстрого доступа к балансам
    const balanceMap = new Map();
    lastBalances.forEach(item => {
      balanceMap.set(item._id.toString(), {
        balance: item.balance || 0,
        previousBalance: item.previousBalance,
        checkedAt: item.checkedAt
      });
    });
    
    // Фильтруем кошельки с балансом больше $100
    const walletsWithBalance = [];
    const walletBalanceData = new Map(); // Сохраняем данные балансов для использования на странице
    
    for (const wallet of allWallets) {
      const walletIdStr = wallet._id.toString();
      const balanceData = balanceMap.get(walletIdStr);
      
      let currentBalance = 0;
      let lastCheckTime = null;
      
      if (balanceData && balanceData.balance) {
        currentBalance = balanceData.balance;
        lastCheckTime = balanceData.checkedAt;
      } else if (wallet.balance !== null && wallet.balance !== undefined) {
        currentBalance = wallet.balance;
        lastCheckTime = wallet.lastBalanceCheck;
      }
      
      // Добавляем только кошельки с балансом больше $100
      if (currentBalance > MIN_BALANCE) {
        walletsWithBalance.push(wallet);
        walletBalanceData.set(walletIdStr, {
          balance: currentBalance,
          previousBalance: balanceData?.previousBalance || null,
          checkedAt: lastCheckTime
        });
      }
    }

    if (walletsWithBalance.length === 0) {
      await bot.sendMessage(chatId, '📭 Нет кошельков с балансом больше $100.');
      return;
    }

    const WALLETS_PER_PAGE = 10;
    const totalPages = Math.ceil(walletsWithBalance.length / WALLETS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * WALLETS_PER_PAGE;
    const endIndex = Math.min(startIndex + WALLETS_PER_PAGE, walletsWithBalance.length);
    const walletsOnPage = walletsWithBalance.slice(startIndex, endIndex);

    // Вычисляем время до следующей проверки
    const timeUntilNext = getTimeUntilNextCheck();
    
    // Собираем все времена последней проверки для определения самого последнего
    let allLastCheckTimes = [];
    
    let message = `💼 Кошельки с балансом > $100 (${walletsWithBalance.length}):\n`;
    message += `📄 Страница ${currentPage + 1} из ${totalPages}\n\n`;
    
    for (let i = 0; i < walletsOnPage.length; i++) {
      const wallet = walletsOnPage[i];
      const globalIndex = startIndex + i;
      const walletIdStr = wallet._id.toString();
      const balanceData = walletBalanceData.get(walletIdStr);
      
      let balanceStr = '';
      let changeStr = '';
      
      if (balanceData && balanceData.balance) {
        const currentBalance = balanceData.balance;
        balanceStr = `💰 Баланс: $${formatNumberWithCommas(currentBalance)}\n`;
        
        // Сохраняем время для общего блока
        if (balanceData.checkedAt) {
          allLastCheckTimes.push(new Date(balanceData.checkedAt));
        }
        
        // Вычисляем изменение баланса
        const previousBalance = balanceData.previousBalance;
        
        if (previousBalance !== null && previousBalance !== undefined && previousBalance > 0) {
          const difference = currentBalance - previousBalance;
          const percentChange = (difference / previousBalance) * 100;
          
          // Показываем изменения только если они положительные или нулевые
          if (difference >= 0) {
            const diffSign = difference > 0 ? '+' : '';
            const percentSign = percentChange > 0 ? '+' : '';
            const formattedDiff = formatLargeNumber(difference);
            
            changeStr = `📊 Изменение: ${diffSign}$${formattedDiff} (${percentSign}${percentChange.toFixed(2)}%)\n`;
          }
          // Если изменение отрицательное - не показываем
        } else {
          changeStr = `📊 Первая проверка баланса\n`;
        }
      } else if (wallet.balance !== null && wallet.balance !== undefined) {
        balanceStr = `💰 Баланс: $${formatNumberWithCommas(wallet.balance)}\n`;
        if (wallet.lastBalanceCheck) {
          allLastCheckTimes.push(new Date(wallet.lastBalanceCheck));
        }
      } else {
        balanceStr = `💰 Баланс: не проверен\n`;
      }
      
      message += `${globalIndex + 1}. 📁 Проект: ${wallet.project}\n`;
      message += `   👤 User ID: ${wallet.user_id}\n`;
      message += `   📝 Алиас: ${wallet.alias || 'не указан'}\n`;
      message += `   💼 Адрес: ${wallet.wallet_destination}\n`;
      message += `   ${balanceStr}`;
      if (changeStr) {
        message += `   ${changeStr}`;
      }
      message += `\n`;
    }
    
    // Находим самое последнее время проверки
    let lastCheckTimeStr = '';
    if (allLastCheckTimes.length > 0) {
      const latestCheckTime = new Date(Math.max(...allLastCheckTimes));
      lastCheckTimeStr = `🕐 Время последней проверки: ${latestCheckTime.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n`;
    }
    
    // Добавляем информацию о проверках в конец сообщения
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (lastCheckTimeStr) {
      message += `${lastCheckTimeStr}`;
    }
    message += `⏰ Следующая проверка: ${timeUntilNext.nextCheckTime} (МСК)\n`;
    message += `⏳ Время до следующей проверки: ${timeUntilNext.hours}ч ${timeUntilNext.minutes}м\n`;

    // Создаем кнопки навигации
    const keyboard = [];
    const navRow = [];
    
    if (currentPage > 0) {
      navRow.push({ text: '◀️ Назад', callback_data: `wallets_page_${currentPage - 1}` });
    }
    
    if (currentPage < totalPages - 1) {
      navRow.push({ text: 'Вперед ▶️', callback_data: `wallets_page_${currentPage + 1}` });
    }
    
    if (navRow.length > 0) {
      keyboard.push(navRow);
    }

    const options = {
      reply_markup: {
        inline_keyboard: keyboard
      }
    };

    if (messageId) {
      // Обновляем существующее сообщение
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
    } else {
      // Отправляем новое сообщение
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error('❌ Ошибка при получении списка кошельков:', error);
    if (messageId) {
      await bot.answerCallbackQuery({ callback_query_id: error.callback_query?.id, text: '❌ Произошла ошибка. Попробуйте позже.' });
    } else {
      await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  }
};

// Обработка команды /wallets - просмотр всех кошельков
bot.onText(/\/wallets/, async (msg) => {
  const chatId = msg.chat.id;
  await registerBotSubscriber(msg);
  await showWalletsPage(chatId, 0);
});

// Обработка callback-запросов для навигации по страницам
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (data && data.startsWith('wallets_page_')) {
    const page = parseInt(data.replace('wallets_page_', ''), 10);
    await bot.answerCallbackQuery({ callback_query_id: query.id });
    await showWalletsPage(chatId, page, messageId);
  }
});

/**
 * Проверяет баланс одного кошелька из БД, обновляет запись и пишет BalanceHistory.
 * @returns {{ ok: true, balanceUSD: number, walletResult: object } | { ok: false, error: string }}
 */
const checkAndRecordSingleWallet = async (wallet) => {
  const balanceResult = await checkBalance(wallet.wallet_destination);

  if (!balanceResult.success) {
    return {
      ok: false,
      error: balanceResult.error || 'Не удалось получить баланс'
    };
  }

  const previousHistory = await BalanceHistory.findOne({ wallet_id: wallet._id }).sort({ checkedAt: -1 });
  const previousBalance = previousHistory ? previousHistory.balance : null;

  console.log(`\nКошелек: ${wallet.wallet_destination}`);
  const balanceUSD = await convertToUSD(balanceResult);
  console.log(`Итого: $${formatNumberWithCommas(balanceUSD)}`);

  let difference = 0;
  let percentChange = 0;
  let isFirstCheck = false;

  if (previousBalance !== null && previousBalance !== undefined) {
    difference = balanceUSD - previousBalance;
    percentChange = previousBalance > 0 ? (difference / previousBalance) * 100 : 0;

    const diffSign = difference >= 0 ? '+' : '';
    const percentSign = percentChange >= 0 ? '+' : '';
    const formattedDiff = formatLargeNumber(difference);

    console.log(`📊 Изменение: ${diffSign}$${formattedDiff} (${percentSign}${percentChange.toFixed(2)}%)`);
    console.log(`   Предыдущий баланс: $${formatNumberWithCommas(previousBalance)}`);
  } else {
    isFirstCheck = true;
    console.log(`📊 Первая проверка баланса`);
  }
  console.log('');

  wallet.lastBalanceCheck = new Date();
  await wallet.save();

  const usdtToken = balanceResult.tokens?.find(
    (t) => t.contract_address === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  );
  const balanceUSDT = usdtToken ? usdtToken.balance : 0;

  const balanceHistory = new BalanceHistory({
    wallet_id: wallet._id,
    wallet_destination: wallet.wallet_destination,
    balance: balanceUSD,
    previousBalance: previousBalance !== null && previousBalance !== undefined ? previousBalance : null,
    balanceTRX: balanceResult.balanceTRX || 0,
    balanceUSDT: balanceUSDT
  });
  await balanceHistory.save();

  const walletResult = {
    address: wallet.wallet_destination,
    project: wallet.project,
    currentBalance: balanceUSD,
    previousBalance,
    difference,
    percentChange,
    isFirstCheck
  };

  return { ok: true, balanceUSD, walletResult };
};

// Функция для проверки балансов всех кошельков
const checkAllWalletsBalance = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.error('⚠️ MongoDB недоступна для проверки балансов');
      console.error('💡 Проверьте подключение к MongoDB. Мониторинг будет продолжен при восстановлении связи.');
      return { totalNetAssets: 0, previousTotalNetAssets: 0, walletResults: [] };
    }

    const wallets = await Wallet.find();
    
    if (wallets.length === 0) {
      console.log('📭 Нет кошельков для проверки');
      return { totalNetAssets: 0, previousTotalNetAssets: 0, walletResults: [] };
    }

    let successCount = 0;
    let errorCount = 0;
    let totalNetAssets = 0;
    let previousTotalNetAssets = 0;
    const walletResults = []; // Массив для хранения результатов по каждому кошельку

    // Получаем предыдущий общий Net Assets (сумма всех последних балансов)
    const previousHistories = await BalanceHistory.aggregate([
      {
        $sort: { checkedAt: -1 }
      },
      {
        $group: {
          _id: '$wallet_id',
          lastBalance: { $first: '$balance' },
          lastCheckedAt: { $first: '$checkedAt' }
        }
      }
    ]);
    
    previousTotalNetAssets = previousHistories.reduce((sum, h) => sum + (h.lastBalance || 0), 0);

    for (const wallet of wallets) {
      try {
        const recorded = await checkAndRecordSingleWallet(wallet);
        if (recorded.ok) {
          totalNetAssets += recorded.balanceUSD;
          walletResults.push(recorded.walletResult);
          successCount++;
        } else {
          errorCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        errorCount++;
      }
    }


    return { totalNetAssets, previousTotalNetAssets, walletResults };
  } catch (error) {
    console.error('❌ Критическая ошибка при проверке балансов:', error);
    return { totalNetAssets: 0, previousTotalNetAssets: 0, walletResults: [] };
  }
};

// Проверка баланса одного кошелька по адресу (должен быть в базе)
bot.onText(/\/checkwallet(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  await registerBotSubscriber(msg);

  try {
    if (mongoose.connection.readyState !== 1) {
      await bot.sendMessage(chatId, '⚠️ База данных недоступна. Проверка не может быть выполнена.');
      return;
    }

    const rawArg = match[1]?.trim();
    if (!rawArg) {
      await bot.sendMessage(
        chatId,
        '🔍 Проверка одного кошелька\n\n' +
          'Укажите адрес из базы в той же строке, например:\n' +
          '/checkwallet TSsX76Who8D36fFoBKLSxihkX3CWwBNQcB\n\n' +
          'Кошелёк должен быть добавлен через /addwallet.'
      );
      return;
    }

    const address = rawArg.split(/\s+/)[0];
    const wallet = await Wallet.findOne({ wallet_destination: address });

    if (!wallet) {
      await bot.sendMessage(
        chatId,
        '❌ Кошелёк с таким адресом не найден в базе.\n\nПроверьте адрес или добавьте кошелёк: /addwallet'
      );
      return;
    }

    await bot.sendMessage(chatId, '🔄 Проверяю баланс…');

    const recorded = await checkAndRecordSingleWallet(wallet);

    if (!recorded.ok) {
      await bot.sendMessage(chatId, `❌ ${recorded.error}`);
      return;
    }

    const wr = recorded.walletResult;
    let reply =
      `✅ Баланс обновлён\n\n` +
      `📁 Проект: ${wr.project}\n` +
      `👤 User ID: ${wallet.user_id}\n` +
      `📝 Алиас: ${wallet.alias || 'не указан'}\n` +
      `💼 Адрес: ${wr.address}\n\n` +
      `💰 Оценка (USD): $${formatNumberWithCommas(wr.currentBalance)}\n`;

    if (!wr.isFirstCheck) {
      const diffSign = wr.difference >= 0 ? '+' : '';
      const pctSign = wr.percentChange >= 0 ? '+' : '';
      reply +=
        `\n📊 Изменение: ${diffSign}$${formatLargeNumber(wr.difference)} (${pctSign}${wr.percentChange.toFixed(2)}%)\n` +
        `Предыдущий баланс: $${formatNumberWithCommas(wr.previousBalance)}`;
    } else {
      reply += `\n📊 Первая запись в истории для этого кошелька.`;
    }

    await bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error('❌ Ошибка при проверке одного кошелька:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message || error}`);
  }
});

// Обработка команды /checkbalance - проверка балансов всех кошельков
bot.onText(/\/checkbalance/, async (msg) => {
  const chatId = msg.chat.id;
  await registerBotSubscriber(msg);

  try {
    if (mongoose.connection.readyState !== 1) {
      await bot.sendMessage(chatId, '⚠️ База данных недоступна. Проверка не может быть выполнена.');
      return;
    }

    // Проверяем, есть ли кошельки для проверки
    const walletsCount = await Wallet.countDocuments();
    if (walletsCount === 0) {
      await bot.sendMessage(chatId, '📭 Нет кошельков для проверки. Добавьте кошельки командой /addwallet');
      return;
    }

    await bot.sendMessage(
      chatId,
      `🔄 Начинаю проверку балансов...\n\n` +
      `📊 Кошельков в базе: ${walletsCount}\n\n` +
      `Проверка выполняется, пожалуйста подождите...`
    );

    // Выполняем проверку
    const { totalNetAssets, previousTotalNetAssets, walletResults } = await checkAllWalletsBalance();

    // Формируем сообщение с результатами
    let message = `✅ Проверка завершена!\n\n`;
    message += `📊 Проверено кошельков: ${walletsCount}\n\n`;
    message += `💰 Net Assets: $${formatNumberWithCommas(totalNetAssets)}\n`;

    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ Ошибка при проверке балансов:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при проверке балансов.');
  }
});

// Функция для автоматической проверки балансов
const performAutomaticBalanceCheck = async () => {
  try {
    console.log(`\n🔄 Автоматическая проверка балансов начата в ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    
    if (mongoose.connection.readyState !== 1) {
      console.error('⚠️ База данных недоступна. Автоматическая проверка не может быть выполнена.');
      return;
    }

    const walletsCount = await Wallet.countDocuments();
    if (walletsCount === 0) {
      console.log('📭 Нет кошельков для проверки. Автоматическая проверка пропущена.');
      return;
    }

    // Выполняем проверку
    const { totalNetAssets, previousTotalNetAssets, walletResults } = await checkAllWalletsBalance();

    // Выводим результаты в консоль
    console.log(`\n✅ Автоматическая проверка завершена`);
    console.log(`📊 Проверено кошельков: ${walletsCount}`);
    console.log(`💰 Net Assets: $${formatNumberWithCommas(totalNetAssets)}`);
    
    if (previousTotalNetAssets > 0) {
      const totalDifference = totalNetAssets - previousTotalNetAssets;
      const totalPercentChange = (totalDifference / previousTotalNetAssets) * 100;
      const totalDiffSign = totalDifference >= 0 ? '+' : '';
      const totalPercentSign = totalPercentChange >= 0 ? '+' : '';
      const formattedTotalDiff = formatLargeNumber(totalDifference);
      
      console.log(`📊 Изменение Net Assets: ${totalDiffSign}$${formattedTotalDiff} (${totalPercentSign}${totalPercentChange.toFixed(2)}%)`);
      console.log(`📉 Предыдущий Net Assets: $${formatNumberWithCommas(previousTotalNetAssets)}`);
    } else {
      console.log(`📊 Первая проверка Net Assets`);
    }
    console.log('');

    // После плановой проверки (6:00 / 15:00 МСК) — разослать всем, кто хоть раз писал боту (/start, /wallets, …)
    const subscribers = await BotSubscriber.find({}).lean();
    if (subscribers.length === 0) {
      console.log('📭 Нет подписчиков для авто-/wallets (никто ещё не писал боту при работающей БД).');
    } else {
      const intro =
        `⏰ Автопроверка балансов завершена (${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК).\n` +
        `📋 Список кошельков (как /wallets):`;
      let ok = 0;
      for (const sub of subscribers) {
        try {
          await bot.sendMessage(sub.chatId, intro);
          await showWalletsPage(sub.chatId, 0);
          ok++;
        } catch (sendErr) {
          const code =
            sendErr.response?.body?.error_code ??
            sendErr.response?.statusCode ??
            sendErr.code;
          if (code === 403) {
            await BotSubscriber.deleteOne({ chatId: sub.chatId }).catch(() => {});
            console.log(`🗑️ Чат ${sub.chatId} удалён из рассылки (бот заблокирован или исключён).`);
          } else {
            console.error(`❌ Авто-/wallets для chat ${sub.chatId}:`, sendErr.message || sendErr);
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      console.log(`📤 Авто-/wallets: отправлено ${ok} из ${subscribers.length} чат(ов).`);
    }
  } catch (error) {
    console.error('❌ Ошибка при автоматической проверке балансов:', error);
  }
};

// Настройка автоматической проверки балансов
// Проверка в 6:00 по МСК
cron.schedule('0 6 * * *', performAutomaticBalanceCheck, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

// Проверка в 15:00 по МСК
cron.schedule('0 15 * * *', performAutomaticBalanceCheck, {
  scheduled: true,
  timezone: 'Europe/Moscow'
});

console.log('⏰ Автоматическая проверка балансов настроена: 6:00 и 15:00 (МСК)');

// Обработка обычных сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Пропускаем команды
  if (text && text.startsWith('/')) {
    return;
  }

  // Пропускаем сообщения, которые обрабатываются в /addwallet
  // (они обрабатываются через bot.once)

  if (!msg.document) {
    return;
  }

  const fileName = msg.document.file_name || '';
  const isXlsx = fileName.toLowerCase().endsWith('.xlsx');
  if (!isXlsx) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    await bot.sendMessage(chatId, '⚠️ База данных недоступна. Импорт невозможен.');
    return;
  }

  await registerBotSubscriber(msg);
  await bot.sendMessage(chatId, '⏳ Получил файл, начинаю импорт...');

  try {
    const fileInfo = await bot.getFile(msg.document.file_id);
    if (!fileInfo.file_path) {
      throw new Error('Не удалось получить путь к файлу в Telegram.');
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Ошибка загрузки файла из Telegram: ${fileResponse.status}`);
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('Файл не содержит листов.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: ''
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      await bot.sendMessage(chatId, '⚠️ Файл пустой. Добавьте строки с данными.');
      return;
    }

    let successCount = 0;
    let skippedEmptyRows = 0;
    const rowErrors = [];
    const seenWalletsInFile = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const [projectRaw, userIdRaw, aliasRaw, walletRaw] = row;

      const project = normalizeCell(projectRaw);
      const userId = toValidUserId(userIdRaw);
      const alias = normalizeCell(aliasRaw);
      const walletDestination = normalizeCell(walletRaw);

      const isEntireRowEmpty = [project, normalizeCell(userIdRaw), alias, walletDestination]
        .every((value) => value === '');
      if (isEntireRowEmpty) {
        skippedEmptyRows++;
        continue;
      }

      if (!project) {
        rowErrors.push(`Строка ${rowNumber}: пустой проект.`);
        continue;
      }

      if (userId === null) {
        rowErrors.push(`Строка ${rowNumber}: некорректный User ID.`);
        continue;
      }

      if (!walletDestination) {
        rowErrors.push(`Строка ${rowNumber}: пустой адрес кошелька.`);
        continue;
      }

      const walletKey = walletDestination.toLowerCase();
      if (seenWalletsInFile.has(walletKey)) {
        rowErrors.push(`Строка ${rowNumber}: дублирование адреса в файле (${walletDestination}).`);
        continue;
      }
      seenWalletsInFile.add(walletKey);

      try {
        const wallet = new Wallet({
          project,
          user_id: userId,
          alias,
          wallet_destination: walletDestination
        });
        await wallet.save();
        successCount++;
      } catch (error) {
        if (error?.code === 11000) {
          rowErrors.push(`Строка ${rowNumber}: дублирование адреса в базе (${walletDestination}).`);
        } else {
          rowErrors.push(`Строка ${rowNumber}: ${error.message}`);
        }
      }
    }

    let report =
      `✅ Импорт завершен\n\n` +
      `📄 Обработано строк: ${rows.length}\n` +
      `➕ Добавлено: ${successCount}\n` +
      `⏭️ Пустых строк пропущено: ${skippedEmptyRows}\n` +
      `❌ Ошибок: ${rowErrors.length}\n`;

    if (rowErrors.length > 0) {
      const MAX_ERRORS_TO_SHOW = 20;
      const visibleErrors = rowErrors.slice(0, MAX_ERRORS_TO_SHOW);
      report += `\n🧾 Отчет по ошибкам:\n- ${visibleErrors.join('\n- ')}`;
      if (rowErrors.length > MAX_ERRORS_TO_SHOW) {
        report += `\n- ... и еще ${rowErrors.length - MAX_ERRORS_TO_SHOW} ошибок.`;
      }
    }

    await bot.sendMessage(chatId, report);
  } catch (error) {
    console.error('❌ Ошибка импорта xlsx:', error);
    await bot.sendMessage(chatId, `❌ Не удалось обработать файл: ${error.message}`);
  }
});

// Обработка ошибок polling с автоматическим переподключением
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

bot.on('polling_error', (error) => {
  console.error('❌ Ошибка polling:', error.message || error);
  
  // Проверяем тип ошибки
  if (error.code === 'EFATAL' || error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT')) {
    reconnectAttempts++;
    
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      console.log(`🔄 Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
      
      // Пытаемся переподключиться через 5 секунд
      setTimeout(() => {
        try {
          bot.stopPolling();
          setTimeout(() => {
            bot.startPolling({ restart: true });
            console.log('✅ Переподключение к Telegram API выполнено');
            reconnectAttempts = 0; // Сбрасываем счетчик при успехе
          }, 2000);
        } catch (reconnectError) {
          console.error('❌ Ошибка при переподключении:', reconnectError.message);
        }
      }, 5000);
    } else {
      console.error('❌ Превышено максимальное количество попыток переподключения');
      console.error('⚠️ Бот продолжит работу, но могут быть проблемы с получением сообщений');
    }
  }
});

// Обработка успешного подключения
bot.on('webhook_error', (error) => {
  console.error('❌ Ошибка webhook:', error);
});

// Обработка завершения процесса
process.on('SIGINT', async () => {
  console.log('\n⚠️ Получен сигнал SIGINT. Завершение работы...');
  
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️ Получен сигнал SIGTERM. Завершение работы...');
  
  await mongoose.connection.close();
  process.exit(0);
});

console.log('🤖 Бот запущен и готов к работе!');

