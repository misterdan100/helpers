//! this script will download all images from externarl urls strings in a web project, save them in the public/images folder and replace the urls in the source code with the new local paths

// 1. install the required packages: npm install axios glob @babel/parser @babel/traverse @babel/generator @babel/types
// 1. run the script: node image-downloader.js

// image-downloader.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const glob = require('glob');
const crypto = require('crypto');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Configuración
const APP_DIR = path.join(process.cwd(), 'src'); // main forlder to search for external image urls
const PUBLIC_IMAGES_DIR = path.join(process.cwd(), 'public', 'images');
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'];

// Dominios de imágenes conocidos para buscar específicamente
const IMAGE_DOMAINS = [
  'ext.same-assets.com',
  'cloudinary.com',
  'amazonaws.com',
  'imgix.net',
  'unsplash.com',
  'googleusercontent.com',
  'githubusercontent.com',
  'cloudfront.net',
  'images.pexels.com',
  'img.youtube.com',
  'media.giphy.com'
];

// Asegurar que el directorio de imágenes exista
if (!fs.existsSync(PUBLIC_IMAGES_DIR)) {
  fs.mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true });
  console.log(`✅ Directorio creado: ${PUBLIC_IMAGES_DIR}`);
}

// Función para generar un nombre de archivo único
function generateUniqueFilename(url) {
  const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
  const originalName = path.basename(url).split('?')[0]; // Eliminar parámetros de consulta
  let extension = path.extname(originalName);
  
  // Si no hay extensión, intentar deducirla de la URL o usar jpg por defecto
  if (!extension) {
    // Buscar extensiones conocidas en la URL
    for (const ext of IMAGE_EXTENSIONS) {
      if (url.toLowerCase().includes(ext)) {
        extension = ext;
        break;
      }
    }
    // Si todavía no hay extensión, usar jpg por defecto
    if (!extension) extension = '.jpg';
  }
  
  return `${urlHash}-${originalName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}${extension}`;
}

// Función para detectar si una URL es una imagen externa
function isExternalImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  // Debe ser una URL http/https
  if (!url.startsWith('http')) return false;
  
  // Ignorar data URLs
  if (url.startsWith('data:')) return false;
  
  // Verificar si es un dominio conocido de imágenes
  if (IMAGE_DOMAINS.some(domain => url.includes(domain))) return true;
  
  // Verificar por extensiones de imágenes en la URL
  if (IMAGE_EXTENSIONS.some(ext => url.toLowerCase().endsWith(ext))) return true;
  
  // Verificar patrones comunes de URLs de imágenes
  if (url.includes('/images/') || url.includes('/img/') || url.includes('/photos/')) return true;
  
  // Verificar parámetros comunes de URLs de imágenes
  if (url.includes('image=') || url.includes('picture=') || url.includes('photo=')) return true;
  
  return false;
}

// Función para descargar una imagen
async function downloadImage(url, destPath) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        console.log(`✅ Imagen descargada: ${url} -> ${destPath}`);
        resolve(destPath);
      });
      
      writer.on('error', (err) => {
        console.error(`❌ Error al escribir el archivo: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`❌ Error al descargar ${url}: ${error.message}`);
    throw error;
  }
}

// Función principal para procesar archivos
async function processFiles() {
  // Encontrar todos los archivos JS/JSX/TS/TSX en la carpeta app
  const files = glob.sync(`${APP_DIR}/**/*.{js,jsx,ts,tsx}`, {
    ignore: ['**/node_modules/**', '**/.next/**']
  });
  
  console.log(`🔍 Encontrados ${files.length} archivos para analizar`);
  
  const downloadedImages = new Map(); // Guarda URL -> ruta local
  let totalUrlsFound = 0;
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      let ast;
      
      try {
        // Intentar parsear como TypeScript o JavaScript
        ast = parse(content, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript', 'classProperties'],
        });
      } catch (parseError) {
        console.error(`❌ Error al parsear ${file}: ${parseError.message}`);
        continue;
      }
      
      let modified = false;
      const imageUrls = [];
      
      // Recorrer AST en busca de strings que puedan ser URLs de imágenes
      traverse(ast, {
        StringLiteral(path) {
          const value = path.node.value;
          
          if (isExternalImageUrl(value)) {
            imageUrls.push({
              url: value,
              nodePath: path
            });
            totalUrlsFound++;
          }
        },
        JSXAttribute(path) {
          // Buscar en atributos src, srcSet, backgroundImage, etc.
          const attrName = path.node.name.name;
          if (['src', 'srcSet', 'href', 'background', 'backgroundImage'].includes(attrName)) {
            if (path.node.value.type === 'StringLiteral' && isExternalImageUrl(path.node.value.value)) {
              imageUrls.push({
                url: path.node.value.value,
                nodePath: path.get('value')
              });
              totalUrlsFound++;
            }
          }
        },
        // Buscar también en objetos literales y asignaciones
        ObjectProperty(path) {
          if (path.node.value.type === 'StringLiteral' && 
              ['src', 'url', 'image', 'backgroundImage'].includes(path.node.key.name || path.node.key.value)) {
            const value = path.node.value.value;
            if (isExternalImageUrl(value)) {
              imageUrls.push({
                url: value,
                nodePath: path.get('value')
              });
              totalUrlsFound++;
            }
          }
        },
        // Buscar en plantillas literales
        TemplateLiteral(path) {
          // Convertir la plantilla literal a una cadena para análisis
          // Esto es una aproximación ya que las plantillas pueden contener expresiones
          try {
            const quasis = path.node.quasis.map(q => q.value.cooked).join('');
            if (isExternalImageUrl(quasis)) {
              console.log(`⚠️ Detectada posible URL de imagen en plantilla literal en ${file}: ${quasis}`);
              // No modificamos las plantillas literales automáticamente
            }
          } catch (e) {
            // Ignorar errores en la evaluación de plantillas
          }
        }
      });
      
      console.log(`Found ${imageUrls.length} image URLs in ${file}`);
      
      // Procesar cada URL de imagen encontrada
      for (const { url, nodePath } of imageUrls) {
        // Verificar si ya hemos descargado esta imagen
        if (!downloadedImages.has(url)) {
          const filename = generateUniqueFilename(url);
          const localPath = path.join(PUBLIC_IMAGES_DIR, filename);
          
          try {
            // Descargar la imagen
            await downloadImage(url, localPath);
            downloadedImages.set(url, `/images/${filename}`);
          } catch (error) {
            console.error(`❌ No se pudo descargar ${url}: ${error.message}`);
            continue;
          }
        }
        
        // Actualizar el nodo con la nueva ruta
        nodePath.node.value = downloadedImages.get(url);
        modified = true;
      }
      
      // Si se modificó el archivo, guardarlo
      if (modified) {
        const newCode = generate(ast, {
          retainLines: true,
          comments: true,
        }).code;
        
        fs.writeFileSync(file, newCode, 'utf8');
        console.log(`✅ Actualizado el archivo: ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error procesando ${file}: ${error.message}`);
    }
  }
  
  console.log(`\n📊 Resumen del proceso:`);
  console.log(`- URLs de imágenes encontradas: ${totalUrlsFound}`);
  console.log(`- Imágenes únicas descargadas: ${downloadedImages.size}`);
  console.log(`- Ubicación de las imágenes descargadas: ${PUBLIC_IMAGES_DIR}`);
  console.log(`\n🎉 Proceso completado con éxito.`);
}

// Ejecutar el script
processFiles().catch(err => {
  console.error('Error en el proceso principal:', err);
  process.exit(1);
});