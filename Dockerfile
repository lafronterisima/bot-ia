FROM node:20-slim

WORKDIR /workspace

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias exactas
RUN npm install --production

# Copiar el resto del código fuente (incluyendo index.js)
COPY . .

# Puerto expuesto para Northflank
EXPOSE 8080

# Comando de inicio
CMD ["node", "server.js"]
