#!/bin/bash

# Скрипт исправления аутентификации MongoDB

set -e

echo "🔍 Проверка состояния MongoDB..."

# Проверка, запущена ли MongoDB
if ! systemctl is-active --quiet mongod 2>/dev/null; then
    echo "🚀 Запуск MongoDB..."
    sudo systemctl start mongod
    sleep 2
fi

echo "✅ MongoDB запущена"
echo ""

# Проверка, включена ли аутентификация
echo "🔍 Проверка конфигурации..."
if grep -q "authorization: enabled" /etc/mongod.conf 2>/dev/null; then
    echo "⚠️  Аутентификация уже включена"
    echo "🔄 Временно отключаем для создания пользователя..."
    
    # Временно отключаем аутентификацию
    sudo sed -i 's/authorization: enabled/# authorization: enabled/' /etc/mongod.conf
    sudo systemctl restart mongod
    sleep 3
    AUTH_WAS_ENABLED=true
else
    AUTH_WAS_ENABLED=false
fi

echo ""
read -sp "Введите пароль для пользователя cryptobot: " PASSWORD
echo ""
read -sp "Подтвердите пароль: " PASSWORD_CONFIRM
echo ""

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
    echo "❌ Пароли не совпадают!"
    exit 1
fi

if [ -z "$PASSWORD" ] || [ ${#PASSWORD} -lt 8 ]; then
    echo "❌ Пароль должен быть минимум 8 символов!"
    exit 1
fi

echo ""
echo "📝 Создание/обновление пользователя cryptobot..."

# Удаляем старого пользователя если есть
mongosh --quiet <<EOF
use cryptocheck
try {
    db.dropUser("cryptobot")
    print("🗑️  Старый пользователь удален")
} catch(e) {
    // Игнорируем если пользователя нет
}
EOF

# Создаем нового пользователя
mongosh --quiet <<EOF
use cryptocheck
try {
    db.createUser({
        user: "cryptobot",
        pwd: "$PASSWORD",
        roles: [ { role: "readWrite", db: "cryptocheck" } ]
    })
    print("✅ Пользователь cryptobot создан успешно")
} catch(e) {
    print("❌ Ошибка создания пользователя: " + e.message)
    throw e
}
EOF

echo ""
echo "🔐 Включение аутентификации..."

# Включаем аутентификацию
if [ "$AUTH_WAS_ENABLED" = false ]; then
    if ! grep -q "^security:" /etc/mongod.conf; then
        echo "" | sudo tee -a /etc/mongod.conf
        echo "security:" | sudo tee -a /etc/mongod.conf
    fi
    
    if ! grep -q "authorization: enabled" /etc/mongod.conf; then
        if grep -q "^security:" /etc/mongod.conf; then
            sudo sed -i '/^security:/a\  authorization: enabled' /etc/mongod.conf
        else
            echo "security:" | sudo tee -a /etc/mongod.conf
            echo "  authorization: enabled" | sudo tee -a /etc/mongod.conf
        fi
    fi
else
    # Возвращаем обратно
    sudo sed -i 's/# authorization: enabled/authorization: enabled/' /etc/mongod.conf
fi

echo "🔄 Перезапуск MongoDB..."
sudo systemctl restart mongod
sleep 3

echo ""
echo "✅ Проверка подключения..."

# Проверяем подключение
if mongosh -u cryptobot -p "$PASSWORD" --authenticationDatabase cryptocheck --eval "db.adminCommand('ping')" --quiet > /dev/null 2>&1; then
    echo "✅ Аутентификация работает!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Настройка завершена успешно!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📝 Обновите файл .env:"
    echo "   MONGODB_URI=mongodb://cryptobot:${PASSWORD}@localhost:27017/cryptocheck?authSource=cryptocheck"
    echo ""
else
    echo "❌ Ошибка аутентификации!"
    echo "Попробуйте подключиться вручную:"
    echo "mongosh -u cryptobot -p '${PASSWORD}' --authenticationDatabase cryptocheck"
fi

