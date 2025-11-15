#!/bin/bash

# Скрипт быстрого развертывания бота на сервере
# Использование: bash deploy.sh

set -e

echo "🚀 Начало развертывания бота..."

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Проверка Node.js
echo -e "${YELLOW}📦 Проверка Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js не установлен!${NC}"
    echo "Установите Node.js: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✅ Node.js установлен: $NODE_VERSION${NC}"

# Проверка npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm не установлен!${NC}"
    exit 1
fi
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✅ npm установлен: $NPM_VERSION${NC}"

# Проверка файла .env
echo -e "${YELLOW}🔐 Проверка файла .env...${NC}"
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  Файл .env не найден. Создаю из примера...${NC}"
    if [ -f env.example ]; then
        cp env.example .env
        echo -e "${YELLOW}📝 Отредактируйте файл .env и добавьте необходимые переменные!${NC}"
        echo -e "${YELLOW}   nano .env${NC}"
        read -p "Нажмите Enter после редактирования .env файла..."
    else
        echo -e "${RED}❌ Файл env.example не найден!${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Файл .env найден${NC}"
fi

# Проверка обязательных переменных
source .env 2>/dev/null || true
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo -e "${RED}❌ TELEGRAM_BOT_TOKEN не установлен в .env!${NC}"
    exit 1
fi
if [ -z "$MONGODB_URI" ]; then
    echo -e "${RED}❌ MONGODB_URI не установлен в .env!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Переменные окружения проверены${NC}"

# Установка зависимостей
echo -e "${YELLOW}📦 Установка зависимостей...${NC}"
npm install
echo -e "${GREEN}✅ Зависимости установлены${NC}"

# Проверка PM2
echo -e "${YELLOW}🔄 Проверка PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}📦 Установка PM2...${NC}"
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 установлен${NC}"
else
    echo -e "${GREEN}✅ PM2 уже установлен${NC}"
fi

# Остановка старого процесса (если есть)
echo -e "${YELLOW}🛑 Остановка старого процесса (если есть)...${NC}"
pm2 delete cryptobot 2>/dev/null || true

# Запуск бота
echo -e "${YELLOW}🚀 Запуск бота...${NC}"
pm2 start bot.js --name cryptobot
pm2 save

# Настройка автозапуска
echo -e "${YELLOW}⚙️  Настройка автозапуска...${NC}"
STARTUP_CMD=$(pm2 startup | grep -o "sudo.*")
if [ ! -z "$STARTUP_CMD" ]; then
    echo -e "${YELLOW}Выполните следующую команду для автозапуска:${NC}"
    echo -e "${GREEN}$STARTUP_CMD${NC}"
    read -p "Выполнить команду сейчас? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        eval $STARTUP_CMD
        echo -e "${GREEN}✅ Автозапуск настроен${NC}"
    fi
fi

# Вывод статуса
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Развертывание завершено!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📊 Статус бота:"
pm2 status cryptobot
echo ""
echo "📝 Полезные команды:"
echo "  pm2 logs cryptobot          - Просмотр логов"
echo "  pm2 restart cryptobot       - Перезапуск бота"
echo "  pm2 stop cryptobot          - Остановка бота"
echo "  pm2 monit                   - Мониторинг ресурсов"
echo ""
echo -e "${GREEN}🎉 Бот запущен и готов к работе!${NC}"

