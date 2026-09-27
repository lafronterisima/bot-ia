FROM node:20-alpine

WORKDIR /workspace

# Copiar manifiestos
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el código fuente
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
