#!/bin/bash

# Скрипт установки MongoDB на Ubuntu/Debian

set -e

echo "📦 Установка MongoDB..."

# Проверка, запущена ли уже MongoDB
if systemctl is-active --quiet mongod 2>/dev/null; then
    echo "✅ MongoDB уже запущена"
    exit 0
fi

# Проверка, установлена ли MongoDB
if command -v mongod &> /dev/null; then
    echo "📦 MongoDB уже установлена, запускаю сервис..."
    sudo systemctl start mongod
    sudo systemctl enable mongod
    echo "✅ MongoDB запущена"
    exit 0
fi

# Установка MongoDB
echo "📥 Импорт ключа MongoDB..."
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "📥 Добавление репозитория..."
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

echo "📥 Обновление списка пакетов..."
sudo apt update

echo "📦 Установка MongoDB..."
sudo apt install -y mongodb-org

echo "🚀 Запуск MongoDB..."
sudo systemctl start mongod
sudo systemctl enable mongod

echo "✅ Проверка статуса..."
sudo systemctl status mongod --no-pager

echo ""
echo "✅ MongoDB успешно установлена и запущена!"
echo ""
echo "📝 Создание пользователя базы данных..."
echo "Выполните следующие команды:"
echo ""
echo "mongosh"
echo "use cryptocheck"
echo "db.createUser({"
echo "  user: 'cryptobot',"
echo "  pwd: 'your_secure_password',"
echo "  roles: [{ role: 'readWrite', db: 'cryptocheck' }]"
echo "})"
echo "exit"
echo ""
echo "Затем обновите .env файл:"
echo "MONGODB_URI=mongodb://cryptobot:your_secure_password@localhost:27017/cryptocheck"

