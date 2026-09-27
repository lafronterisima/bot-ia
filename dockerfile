FROM node:18-alpine

WORKDIR /app

# Copiar manifiestos e instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# Puerto que escuchará la app
EXPOSE 8080

# Comando de inicio
CMD ["node", "index.js"]
