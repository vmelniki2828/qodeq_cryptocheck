# 🔧 Установка и настройка MongoDB

## Проблема: `ECONNREFUSED` - MongoDB недоступна

Эта ошибка означает, что приложение не может подключиться к серверу MongoDB.

## Решение 1: Установка MongoDB локально

### Windows

1. **Скачайте MongoDB:**
   - Перейдите на https://www.mongodb.com/try/download/community
   - Выберите Windows и скачайте установщик

2. **Установите MongoDB:**
   - Запустите установщик
   - Выберите "Complete" установку
   - Отметьте "Install MongoDB as a Service"

3. **Запустите MongoDB:**
   ```bash
   net start MongoDB
   ```

4. **Проверьте работу:**
   ```bash
   mongosh
   ```
   Если подключение успешно, MongoDB работает!

### Linux (Ubuntu/Debian)

1. **Установите MongoDB:**
   ```bash
   sudo apt-get update
   sudo apt-get install -y mongodb
   ```

2. **Запустите MongoDB:**
   ```bash
   sudo systemctl start mongod
   sudo systemctl enable mongod
   ```

3. **Проверьте статус:**
   ```bash
   sudo systemctl status mongod
   ```

### macOS

1. **Установите через Homebrew:**
   ```bash
   brew tap mongodb/brew
   brew install mongodb-community
   ```

2. **Запустите MongoDB:**
   ```bash
   brew services start mongodb-community
   ```

## Решение 2: Использование MongoDB Atlas (Облачный сервис) - РЕКОМЕНДУЕТСЯ

MongoDB Atlas - это бесплатный облачный сервис, не требует локальной установки.

### Шаги:

1. **Зарегистрируйтесь:**
   - Перейдите на https://www.mongodb.com/cloud/atlas/register
   - Создайте бесплатный аккаунт

2. **Создайте кластер:**
   - Войдите в Atlas
   - Нажмите "Build a Database"
   - Выберите бесплатный план (M0)
   - Выберите регион (ближайший к вам)
   - Нажмите "Create"

3. **Создайте пользователя базы данных:**
   - В разделе "Database Access" создайте пользователя
   - Запомните username и password

4. **Настройте сетевой доступ:**
   - В разделе "Network Access"
   - Нажмите "Add IP Address"
   - Выберите "Allow Access from Anywhere" (0.0.0.0/0) для тестирования
   - Или добавьте ваш IP адрес

5. **Получите строку подключения:**
   - В разделе "Database" нажмите "Connect"
   - Выберите "Connect your application"
   - Скопируйте строку подключения
   - Замените `<password>` на ваш пароль
   - Замените `<dbname>` на название базы (например, `cryptocheck`)

6. **Добавьте в .env файл:**
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/cryptocheck?retryWrites=true&w=majority
   ```

## Проверка подключения

После настройки MongoDB, перезапустите бота:

```bash
npm start
```

Вы должны увидеть:
```
✅ MongoDB подключена успешно
📊 База данных: cryptocheck
```

## Устранение проблем

### MongoDB не запускается (Windows)

```bash
# Проверьте службу
sc query MongoDB

# Перезапустите службу
net stop MongoDB
net start MongoDB
```

### Порт 27017 занят

Проверьте, что порт свободен:
```bash
# Windows
netstat -ano | findstr :27017

# Linux/Mac
lsof -i :27017
```

### Проблемы с правами доступа

Убедитесь, что MongoDB имеет права на создание файлов в директории данных.

## Альтернатива: Docker

Если у вас установлен Docker:

```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

Затем используйте стандартный URI:
```env
MONGODB_URI=mongodb://localhost:27017/cryptocheck
```















