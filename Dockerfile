FROM node:20-alpine

WORKDIR /workspace

# Copiar únicamente manifiestos
COPY package*.json ./

# Instalar dependencias omitiendo paquetes opcionales
RUN npm install 

# Copiar el resto de archivos de la aplicación
COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
