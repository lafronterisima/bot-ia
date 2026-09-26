FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# 1. Usar la variable PORT de la plataforma o 8080 por defecto
ENV PORT=8080
# 2. Exponer el puerto 8080
EXPOSE 8080
CMD ["npm", "start"]
