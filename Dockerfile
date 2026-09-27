FROM node:20-slim

WORKDIR /workspace

# Copiar manifiestos
COPY package*.json ./

# Instalar paquetes directamente
RUN npm install

# Copiar el resto del código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
