FROM node:20-alpine

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar paquetes requeridos
RUN npm install

# Copiar el resto del código
COPY . .

EXPOSE 8080

# Ejecutar la aplicación
CMD ["node", "server.js"]
