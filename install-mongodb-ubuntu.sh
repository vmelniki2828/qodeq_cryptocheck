#!/bin/bash

# Скрипт установки MongoDB на Ubuntu 24.04 (noble)

set -e

echo "📦 Установка MongoDB на Ubuntu..."

# Проверка версии Ubuntu
UBUNTU_VERSION=$(lsb_release -rs)
echo "📋 Версия Ubuntu: $UBUNTU_VERSION"

# Определение кодового имени
if [ "$UBUNTU_VERSION" == "24.04" ]; then
    CODENAME="jammy"  # MongoDB репозиторий использует jammy для 24.04
else
    CODENAME="jammy"
fi

echo "📥 Импорт ключа MongoDB..."
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "📥 Добавление репозитория MongoDB..."
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

echo "📥 Обновление списка пакетов..."
sudo apt-get update

echo "📦 Установка MongoDB..."
sudo apt-get install -y mongodb-org

echo "🚀 Запуск MongoDB..."
sudo systemctl start mongod
sudo systemctl enable mongod

echo "✅ Проверка статуса..."
sleep 2
sudo systemctl status mongod --no-pager | head -10

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MongoDB успешно установлена и запущена!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Следующие шаги:"
echo ""
echo "1. Создайте пользователя базы данных:"
echo "   mongosh"
echo "   use cryptocheck"
echo "   db.createUser({"
echo "     user: 'cryptobot',"
echo "     pwd: 'your_secure_password',"
echo "     roles: [{ role: 'readWrite', db: 'cryptocheck' }]"
echo "   })"
echo "   exit"
echo ""
echo "2. Обновите файл .env:"
echo "   nano /home/qodeq_cryptocheck/.env"
echo "   Измените MONGODB_URI на:"
echo "   MONGODB_URI=mongodb://cryptobot:your_secure_password@localhost:27017/cryptocheck"
echo ""
echo "3. Перезапустите бота:"
echo "   pm2 restart cryptobot"
echo ""


