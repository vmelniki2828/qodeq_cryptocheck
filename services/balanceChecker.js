/**
 * Сервис для проверки баланса криптокошельков
 * Поддерживает TRON (TRC20) через TronGrid API
 */

// Определение типа кошелька по адресу
export const detectWalletType = (address) => {
  const trimmed = address.trim();
  
  // TRON адреса начинаются с 'T' и имеют длину 34 символа
  if (trimmed.startsWith('T') && trimmed.length === 34) {
    return 'TRON';
  }
  
  // Ethereum адреса начинаются с '0x' и имеют длину 42 символа
  if (trimmed.startsWith('0x') && trimmed.length === 42) {
    return 'ETHEREUM';
  }
  
  // Bitcoin адреса (разные форматы)
  if (trimmed.startsWith('1') || trimmed.startsWith('3') || trimmed.startsWith('bc1')) {
    return 'BITCOIN';
  }
  
  return 'UNKNOWN';
};

/**
 * Получение всех TRC20 токенов через TronScan API (более полный список, включая SC)
 */
const getAllTRC20TokensFromTronScan = async (address) => {
  try {
    const parseTokenBalance = (token) => {
      // В разных endpoint TronScan баланс может приходить:
      // - уже нормализованным (balanceValue),
      // - в минимальных единицах (balance + decimals),
      // - строкой/числом в разных полях.
      const decimalsRaw =
        token.tokenDecimal ?? token.decimals ?? token.token_info?.decimals ?? 6;
      const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : 6;

      const normalizedRaw = token.balanceValue ?? token.balance_value ?? token.amountValue;
      if (normalizedRaw !== undefined && normalizedRaw !== null) {
        const normalized = Number(normalizedRaw);
        return Number.isFinite(normalized) ? normalized : 0;
      }

      const raw = token.balance ?? token.amount ?? 0;
      const rawNumber = Number(raw);
      if (!Number.isFinite(rawNumber)) {
        return 0;
      }
      return rawNumber / Math.pow(10, decimals);
    };

    // Используем несколько endpoints для получения всех токенов
    const endpoints = [
      `https://apilist.tronscan.org/api/account/tokens?address=${address}`,
      `https://apilist.tronscan.org/api/account/token-balance?address=${address}`,
      `https://apilist.tronscan.org/api/account?address=${address}`
    ];
    
    const allTokens = [];
    const seenContracts = new Set();
    
    // Пробуем получить токены из разных endpoints
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          continue; // Пропускаем, если endpoint недоступен
        }

        const data = await response.json();
        
        // Обрабатываем разные форматы ответов
        let tokensData = [];
        
        if (data.data && Array.isArray(data.data)) {
          tokensData = data.data;
        } else if (data.trc20token_balances && Array.isArray(data.trc20token_balances)) {
          tokensData = data.trc20token_balances;
        } else if (data.tokens && Array.isArray(data.tokens)) {
          tokensData = data.tokens;
        }
        
        tokensData.forEach(token => {
          try {
            const contractAddress = token.tokenId || token.contract_address || token.token_address;
            if (!contractAddress || seenContracts.has(contractAddress)) {
              return; // Пропускаем дубликаты
            }
            
            const decimalsRaw = token.tokenDecimal ?? token.decimals ?? token.token_info?.decimals ?? 6;
            const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : 6;
            const balance = parseTokenBalance(token);
            
            if (balance > 0) {
              seenContracts.add(contractAddress);
              allTokens.push({
                contract_address: contractAddress,
                symbol: token.tokenAbbr || token.symbol || token.tokenName || 'UNKNOWN',
                name: token.tokenName || token.name || 'Unknown Token',
                balance: balance,
                decimals: decimals,
                source: 'TronScan' // Помечаем источник
              });
            }
          } catch (error) {
            console.error(`Ошибка при обработке токена из TronScan:`, error);
          }
        });
      } catch (error) {
        console.error(`Ошибка при запросе к ${endpoint}:`, error.message);
        continue;
      }
    }
    
    return allTokens.length > 0 ? allTokens : null;
  } catch (error) {
    console.error('Ошибка при получении токенов из TronScan:', error);
    return null;
  }
};

/**
 * Проверка баланса TRON кошелька через TronScan API
 */
export const checkTronBalance = async (address) => {
  try {
    // Основной источник данных: TronScan
    const accountResponse = await fetch(`https://apilist.tronscan.org/api/account?address=${address}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!accountResponse.ok) {
      throw new Error(`TronScan API error: ${accountResponse.status} ${accountResponse.statusText}`);
    }

    const accountData = await accountResponse.json();
    if (!accountData) {
      return {
        success: false,
        error: 'Кошелек не найден или адрес неверный'
      };
    }

    // Баланс TRX: TronScan обычно отдает в SUN в поле balance
    const rawTrxBalance =
      accountData.balance ??
      accountData.trxBalance ??
      accountData.trx_balance ??
      accountData.amount ??
      0;
    const balanceTRX = Number(rawTrxBalance) > 0 ? Number(rawTrxBalance) / 1_000_000 : 0;

    // Все TRC20 токены берем через TronScan (несколько endpoint внутри helper)
    const tokensFromTronScan = await getAllTRC20TokensFromTronScan(address);
    const allTokens = (tokensFromTronScan || []).map((token) => ({
      ...token,
      source: token.source || 'TronScan'
    }));

    return {
      success: true,
      balanceTRX: balanceTRX,
      tokens: allTokens, // Все TRC20 токены из TronScan
      raw: accountData
    };
  } catch (error) {
    console.error('Ошибка при проверке баланса TRON:', error);
    return {
      success: false,
      error: error.message || 'Ошибка при проверке баланса'
    };
  }
};

/**
 * Универсальная функция проверки баланса
 */
export const checkBalance = async (address) => {
  const walletType = detectWalletType(address);
  
  switch (walletType) {
    case 'TRON':
      return await checkTronBalance(address);
    
    case 'ETHEREUM':
      // TODO: Добавить поддержку Ethereum
      return {
        success: false,
        error: 'Проверка Ethereum кошельков пока не поддерживается'
      };
    
    case 'BITCOIN':
      // TODO: Добавить поддержку Bitcoin
      return {
        success: false,
        error: 'Проверка Bitcoin кошельков пока не поддерживается'
      };
    
    default:
      return {
        success: false,
        error: `Тип кошелька не определен: ${address.substring(0, 10)}...`
      };
  }
};

// Кэш для курсов токенов (чтобы не делать повторные запросы)
const priceCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

// Кэш для списка активов TronScan
let tronscanAssetsCache = null;
let tronscanAssetsCacheTime = 0;
const TRONSCAN_CACHE_DURATION = 10 * 60 * 1000; // 10 минут

// Очередь запросов с задержкой для избежания rate limit
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1200; // Минимальная задержка между запросами (1.2 секунды)

/**
 * Получение списка активов с ценами из TronScan API
 */
export const getTronScanAssetsWithPrices = async () => {
  try {
    // Проверяем кэш
    if (tronscanAssetsCache && Date.now() - tronscanAssetsCacheTime < TRONSCAN_CACHE_DURATION) {
      return tronscanAssetsCache;
    }

    const response = await fetch('https://apilist.tronscan.org/api/getAssetWithPriceList');
    
    if (!response.ok) {
      throw new Error(`TronScan API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.data && Array.isArray(data.data)) {
      // Создаем Map для быстрого поиска по ID токена
      const assetsMap = new Map();
      data.data.forEach(asset => {
        // Сохраняем по ID (контракт адресу для TRC20, или '_' для TRX)
        if (asset.id) {
          assetsMap.set(asset.id, asset);
        }
        // Также сохраняем по аббревиатуре для поиска
        if (asset.abbr) {
          assetsMap.set(asset.abbr.toUpperCase(), asset);
        }
        // Сохраняем по имени токена (для случаев, когда символ не совпадает)
        if (asset.name) {
          assetsMap.set(asset.name.toUpperCase(), asset);
        }
      });
      
      // Сохраняем в кэш
      tronscanAssetsCache = assetsMap;
      tronscanAssetsCacheTime = Date.now();
      
      return assetsMap;
    }
    
    return null;
  } catch (error) {
    console.error('Ошибка при получении активов из TronScan:', error);
    return null;
  }
};

/**
 * Получение цены токена из TronScan API
 */
export const getTokenPriceFromTronScan = async (contractAddress, symbol = null) => {
  try {
    const assetsMap = await getTronScanAssetsWithPrices();
    
    if (!assetsMap) {
      return null;
    }
    
    // Ищем по контракт адресу
    if (contractAddress && assetsMap.has(contractAddress)) {
      const asset = assetsMap.get(contractAddress);
      if (asset.priceInUsd) {
        return asset.priceInUsd;
      }
    }
    
    // Не фолбэчим по symbol: одинаковые тикеры у разных контрактов
    // дают неверные "цены" для скам/клон-токенов.
    
    // Если цена не найдена - это нормально, не все токены есть в API TronScan
    // Не выводим отладочную информацию, чтобы не засорять консоль
    
    return null;
  } catch (error) {
    console.error('Ошибка при получении цены из TronScan:', error);
    return null;
  }
};

/**
 * Получение курса криптовалюты к USD через CoinGecko API
 */
export const getCryptoPrice = async (coinId) => {
  try {
    // Проверяем кэш
    const cacheKey = coinId.toLowerCase();
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.price;
    }
    
    // Обработка rate limit - добавляем задержку между запросами
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    lastRequestTime = Date.now();
    
    if (!response.ok) {
      if (response.status === 429) {
        console.error(`⚠️ CoinGecko API rate limit (429). Ожидание 60 секунд...`);
        // При rate limit ждем 60 секунд
        await new Promise(resolve => setTimeout(resolve, 60000));
        return null;
      }
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data[coinId] && data[coinId].usd) {
      const price = data[coinId].usd;
      // Сохраняем в кэш
      priceCache.set(cacheKey, { price, timestamp: Date.now() });
      return price;
    }
    
    return null;
  } catch (error) {
    if (error.message.includes('429')) {
      console.error(`⚠️ CoinGecko API rate limit. Пропускаю запрос для ${coinId}`);
      return null;
    }
    console.error(`Ошибка при получении курса ${coinId}:`, error.message);
    return null;
  }
};

/**
 * Получение курса TRX к USD
 * Использует только TronScan API
 */
export const getTRXPrice = async () => {
  try {
    const assetsMap = await getTronScanAssetsWithPrices();
    if (!assetsMap) {
      return 0;
    }
    
    // Ищем TRX по ID = '_' (специальный ID для TRX в TronScan API)
    if (assetsMap.has('_')) {
      const trxAsset = assetsMap.get('_');
      if (trxAsset && trxAsset.priceInUsd) {
        return trxAsset.priceInUsd;
      }
    }
    
    // Если не нашли по ID, ищем по аббревиатуре 'TRX'
    if (assetsMap.has('TRX')) {
      const trxAsset = assetsMap.get('TRX');
      if (trxAsset && trxAsset.priceInUsd) {
        return trxAsset.priceInUsd;
      }
    }
  } catch (error) {
    console.error('Ошибка при получении цены TRX:', error);
  }
  
  // Если цена не найдена, возвращаем 0 (TRX не будет учитываться)
  return 0;
};

/**
 * Получение курса токена по контракту TRC20
 * Популярные токены TRC20 и их CoinGecko ID
 */
const TRC20_TOKEN_MAP = {
  // Стейблкоины (1 USD)
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': { coinId: 'tether', price: 1, symbol: 'USDT' }, // USDT
  'TKfjV9RNKJJCqPvBtK8L7Knykh7DNWvnYt': { coinId: 'usd-coin', price: 1, symbol: 'USDC' }, // USDC
  'TUpMhErZL2fhh4sVNULAbNxokp3Pc9on6g': { coinId: 'true-usd', price: 1, symbol: 'TUSD' }, // TUSD
  'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf': { coinId: 'dai', price: 1, symbol: 'DAI' }, // DAI (если есть на TRON)
  
  // Другие популярные токены
  'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7': { coinId: 'wrapped-bitcoin', price: null, symbol: 'WBTC' }, // WBTC
  'TRX': { coinId: 'tron', price: null, symbol: 'TRX' }, // TRX (но это не TRC20)
};

/**
 * Поиск токена в CoinGecko по символу
 */
export const searchTokenInCoinGecko = async (symbol) => {
  try {
    // Поиск токена через поиск CoinGecko
    const searchResponse = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
    
    if (!searchResponse.ok) {
      return null;
    }

    const searchData = await searchResponse.json();
    
    // Берем первый результат поиска
    if (searchData.coins && searchData.coins.length > 0) {
      const coinId = searchData.coins[0].id;
      const price = await getCryptoPrice(coinId);
      return price;
    }
    
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * Получение курса токена TRC20 по символу через CoinGecko
 */
export const getTokenPriceBySymbol = async (symbol) => {
  if (!symbol || symbol === 'UNKNOWN') {
    return null;
  }
  
  try {
    // Сначала пробуем прямой поиск по символу
    const directPrice = await getCryptoPrice(symbol.toLowerCase());
    if (directPrice) {
      return directPrice;
    }
    
    // Если не нашли, используем поиск
    const searchPrice = await searchTokenInCoinGecko(symbol);
    if (searchPrice) {
      return searchPrice;
    }
    
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * Получение курса токена TRC20
 * Использует только TronScan API
 */
export const getTRC20TokenPrice = async (contractAddress, symbol = null) => {
  // Получаем цену только из TronScan API
  const tronscanPrice = await getTokenPriceFromTronScan(contractAddress, symbol);
  if (tronscanPrice) {
    return tronscanPrice;
  }
  
  // Если цена не найдена в TronScan, пропускаем токен (возвращаем 0)
  return 0;
};

/**
 * Конвертация баланса в доллары (со всеми токенами)
 */
export const convertToUSD = async (balanceResult) => {
  try {
    let totalUSD = 0;
    
    // Конвертируем TRX в USD
    if (balanceResult.balanceTRX && balanceResult.balanceTRX > 0) {
      const trxPrice = await getTRXPrice();
      const trxUSD = balanceResult.balanceTRX * trxPrice;
      totalUSD += trxUSD;
      console.log(
        `TRX | qty: ${Number(balanceResult.balanceTRX).toFixed(6)} | $${trxPrice.toFixed(4)} | $${trxUSD.toFixed(2)}`
      );
    }
    
    // Конвертируем все TRC20 токены в USD
    if (balanceResult.tokens && Array.isArray(balanceResult.tokens) && balanceResult.tokens.length > 0) {
      for (const token of balanceResult.tokens) {
        const tokenPrice = await getTRC20TokenPrice(token.contract_address, token.symbol);
        const tokenUSD = token.balance * tokenPrice;
        
        // Выводим только токены с найденной ценой
        if (tokenPrice > 0) {
          totalUSD += tokenUSD;
          console.log(
            `${token.symbol} | qty: ${Number(token.balance).toFixed(6)} | $${tokenPrice.toFixed(4)} | $${tokenUSD.toFixed(2)}`
          );
        }
        // Токены без цены просто пропускаем (не выводим в консоль)
      }
    }
    
    // Обратная совместимость со старым форматом (balanceUSDT)
    if (balanceResult.balanceUSDT && balanceResult.balanceUSDT > 0) {
      totalUSD += balanceResult.balanceUSDT; // USDT = 1 USD
      console.log(
        `USDT | qty: ${Number(balanceResult.balanceUSDT).toFixed(6)} | $1.0000 | $${balanceResult.balanceUSDT.toFixed(2)}`
      );
    }
    
    return totalUSD;
  } catch (error) {
    console.error('Ошибка при конвертации в USD:', error);
    // Если ошибка, используем примерные курсы
    const trxUSD = (balanceResult.balanceTRX || 0) * 0.1;
    const usdtUSD = balanceResult.balanceUSDT || 0;
    return trxUSD + usdtUSD;
  }
};

/**
 * Форматирование баланса для отображения в долларах
 */
export const formatBalanceUSD = async (balanceResult) => {
  try {
    const usdBalance = await convertToUSD(balanceResult);
    return `$${Number(usdBalance).toFixed(2)}`;
  } catch (error) {
    console.error('Ошибка при форматировании баланса:', error);
    return '$0.00';
  }
};

/**
 * Форматирование баланса для отображения (старая функция для обратной совместимости)
 */
export const formatBalance = (balance, decimals = 6) => {
  if (balance === null || balance === undefined) {
    return '0.000000';
  }
  return Number(balance).toFixed(decimals);
};

