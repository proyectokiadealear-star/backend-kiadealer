# ⚙️ CONSIDERACIONES TÉCNICAS — NOTIFICACIONES, ARCHIVOS Y FIREBASE

## 1. Sistema de Notificaciones (Firebase Cloud Messaging)

### Arquitectura FCM

Las notificaciones **siempre se disparan desde el backend (NestJS)**, nunca desde el frontend. El flujo es:

```
Acción en frontend
      │
      ▼
NestJS recibe request
      │
      ▼
Servicio procesa lógica de negocio
      │
      ▼
VehicleStatusService cambia estado + escribe statusHistory
      │
      ▼
NotificationsService determina destinatarios por rol/sede
      │
      ▼
Firebase Admin SDK → FCM → Dispositivos del usuario
      │
      ▼
Firestore → notifications/{id} (para historial en app)
```

### Registro de FCM Tokens

Cada vez que un usuario abre la app (web o móvil), el cliente registra/actualiza su FCM token en Firestore:

```typescript
// Al hacer login o al obtener nuevo token
await updateDoc(doc(db, 'users', uid), {
  fcmTokens: arrayUnion(currentFcmToken)
});
```

El backend lee `users/{uid}.fcmTokens` para enviar notificaciones multidevice.

---

### Tabla de Notificaciones por Evento

| Evento | Tipo | Destinatario | Plataforma |
|--------|------|--------------|------------|
| Vehículo certificado (CERTIFICADO_STOCK) | ESTADO_CAMBIADO | DOCUMENTACION de la sede | Web push |
| Kilometraje > 10 km | KILOMETRAJE_ALTO | JEFE_TALLER | Web + Móvil |
| Sin improntas | SIN_IMPRONTAS | JEFE_TALLER | Web + Móvil |
| Vehículo documentado | ESTADO_CAMBIADO | ASESOR + LIDER_TECNICO de la sede | Móvil push |
| OT generada | OT_GENERADA | LIDER_TECNICO de la sede | Móvil push |
| Técnico asignado | TECNICO_ASIGNADO | PERSONAL_TALLER asignado | Móvil push |
| Instalación completa | INSTALACION_LISTA | LIDER_TECNICO de la sede | Móvil push |
| Listo para entrega | LISTO_ENTREGA | ASESOR de la sede | Móvil push |
| Agendado | AGENDADO | ASESOR asignado + JEFE_TALLER | Web + Móvil |
| Reapertura OT | REAPERTURA | JEFE_TALLER + LIDER_TECNICO | Web + Móvil |
| Cambio de sede | CAMBIO_SEDE | JEFE_TALLER | Web + Móvil |
| Cedido | CEDIDO | JEFE_TALLER | Web + Móvil |
| Vehículo entregado | ESTADO_CAMBIADO | JEFE_TALLER | Web + Móvil |

---

### Implementación NestJS — NotificationsService

```typescript
// src/modules/notifications/notifications.service.ts
@Injectable()
export class NotificationsService {

  async notifyByRole(
    role: RoleEnum,
    sede: SedeEnum | 'ALL',
    notification: NotificationPayload
  ): Promise<void> {
    // 1. Obtener usuarios con ese rol y esa sede
    const users = await this.getUsersByRoleAndSede(role, sede);

    // 2. Recopilar todos sus FCM tokens
    const tokens = users.flatMap(u => u.fcmTokens).filter(Boolean);

    // 3. Enviar via Firebase Admin SDK
    if (tokens.length > 0) {
      await this.firebaseAdmin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          type: notification.type,
          vehicleId: notification.vehicleId ?? '',
          chassis: notification.chassis ?? '',
        },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
        webpush: {
          notification: { icon: '/icons/kia-icon.png' }
        }
      });
    }

    // 4. Guardar en Firestore para historial en-app
    await this.saveNotificationToFirestore(notification, role, sede);
  }
}
```

---

### Recepción en Móvil (Expo)

```typescript
// mobile/src/services/notifications.service.ts
import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';

// Configurar handler foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Obtener token y registrar en backend
export async function registerPushToken(uid: string) {
  const token = await messaging().getToken();
  await apiClient.post('/users/fcm-token', { token });
}
```

---

### Recepción en Web (Next.js)

```typescript
// web/src/lib/firebase-messaging.ts
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

export async function initWebPush(uid: string) {
  const messaging = getMessaging();
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  });
  await apiClient.post('/users/fcm-token', { token });

  onMessage(messaging, (payload) => {
    // Mostrar toast o actualizar badge en header
    showNotificationToast(payload.notification);
  });
}
```

> **Nota para el agente:** El Service Worker de Next.js (`public/firebase-messaging-sw.js`) debe configurarse para recibir notificaciones en background cuando la pestaña no está activa.

---

## 2. Visualización de Archivos PDF

### Contexto

El sistema maneja PDFs en las siguientes situaciones:
- Factura del vehículo
- Correo de obsequio
- Factura de accesorios
- Documento de cesión al concesionario
- Acta firmada de entrega (foto, no PDF)
- Reportes generados por el sistema

### Almacenamiento en Firebase Storage

**Estructura de rutas en Storage:**

```
storage/
├── vehicles/{vehicleId}/
│   ├── photo.jpg                    # Foto del vehículo
│   ├── rims-photo.jpg               # Foto de los aros
│   ├── docs/
│   │   ├── vehicle-invoice.pdf
│   │   ├── gift-email.pdf
│   │   └── accessory-invoice.pdf
│   ├── delivery/
│   │   ├── ceremony-photo.jpg
│   │   └── signed-acta.jpg
│   └── transfer/
│       └── concession-document.pdf
└── reports/{reportId}/
    └── vehicle-report.pdf
```

### URLs Firmadas (Backend)

El backend genera URLs temporales con expiración. El frontend nunca accede directamente a Storage:

```typescript
// src/modules/storage/storage.service.ts
async getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const file = this.bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresIn * 1000,
  });
  return url;
}
```

---

### Visualización en Web (Next.js)

Se usa la librería `react-pdf` para renderizar PDFs dentro de la interfaz sin redirigir al usuario a otra pestaña:

```bash
npm install react-pdf
```

```typescript
// web/src/components/PdfViewer.tsx
'use client';
import { Document, Page } from 'react-pdf';
import { useState } from 'react';

interface PdfViewerProps {
  url: string;
  onReplace?: () => void;  // Solo para roles con permiso
}

export function PdfViewer({ url, onReplace }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-controls">
        <button onClick={() => setPageNumber(p => Math.max(1, p - 1))}>‹</button>
        <span>{pageNumber} / {numPages}</span>
        <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}>›</button>
        {onReplace && (
          <button onClick={onReplace} className="btn-replace">
            Reemplazar documento
          </button>
        )}
      </div>
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
      >
        <Page pageNumber={pageNumber} width={700} />
      </Document>
    </div>
  );
}
```

**Contexto de uso por rol:**

| Rol | Puede ver PDF | Puede reemplazar PDF |
|-----|:------------:|:-------------------:|
| JEFE_TALLER | ✅ | ✅ |
| DOCUMENTACION | ✅ | ✅ |
| ASESOR | ❌ | ❌ |
| LIDER_TECNICO | ❌ | ❌ |
| PERSONAL_TALLER | ❌ | ❌ |

---

### Visualización en Móvil (Expo)

Para móvil se usa `expo-file-system` + `expo-sharing` o apertura en WebView nativo:

```bash
npx expo install expo-file-system expo-sharing expo-web-browser
```

```typescript
// mobile/src/components/PdfViewer.tsx
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system';

export async function openPdf(signedUrl: string, filename: string) {
  // Descargar y abrir con visor nativo del sistema
  const localUri = FileSystem.cacheDirectory + filename;
  const { uri } = await FileSystem.downloadAsync(signedUrl, localUri);
  await WebBrowser.openBrowserAsync(uri);
}
```

> El acceso a PDF en móvil es solo para JEFE_TALLER. Los demás roles móviles no tienen acceso a documentos.

---

## 3. Gestión de Archivos en Firebase Storage

### Upload desde Backend (NestJS)

El frontend envía el archivo al backend (multipart/form-data). El backend lo sube a Storage y devuelve la URL:

```typescript
// Usando Multer + Firebase Storage en NestJS
@Post('upload')
@UseInterceptors(FileInterceptor('file'))
async uploadFile(
  @UploadedFile() file: Express.Multer.File,
  @Body('path') storagePath: string,
) {
  const bucket = this.firebaseAdmin.storage().bucket();
  const fileRef = bucket.file(storagePath);
  await fileRef.save(file.buffer, {
    metadata: { contentType: file.mimetype }
  });
  return { path: storagePath };
}
```

### Upload desde Móvil (Expo) — Fotos

Las fotos (vehículo, aros, ceremonia) se suben directamente desde la cámara del dispositivo:

```typescript
import * as ImagePicker from 'expo-image-picker';
import storage from '@react-native-firebase/storage';

export async function uploadVehiclePhoto(vehicleId: string): Promise<string> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });

  if (!result.canceled) {
    const path = `vehicles/${vehicleId}/photo.jpg`;
    await storage().ref(path).putFile(result.assets[0].uri);
    return path;  // Enviar path al backend para que genere URL firmada
  }
}
```

---

## 4. Reglas de Seguridad Firestore

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Función para verificar rol
    function hasRole(role) {
      return request.auth != null
        && request.auth.token.role == role
        && request.auth.token.active == true;
    }

    // Función para verificar sede
    function hasSede(sede) {
      return request.auth.token.sede == sede
        || request.auth.token.sede == 'ALL';
    }

    // Vehículos
    match /vehicles/{vehicleId} {
      allow read: if request.auth != null
        && request.auth.token.active == true
        && (request.auth.token.sede == 'ALL'
            || request.auth.token.sede == resource.data.sede);

      allow create: if hasRole('ASESOR') || hasRole('LIDER_TECNICO')
        || hasRole('PERSONAL_TALLER') || hasRole('JEFE_TALLER');

      allow update: if request.auth != null && request.auth.token.active == true;
      allow delete: if hasRole('JEFE_TALLER');

      // StatusHistory — solo lectura para todos, escritura solo desde backend
      match /statusHistory/{historyId} {
        allow read: if request.auth != null && request.auth.token.active == true;
        allow write: if false;  // Solo escritura via Firebase Admin SDK (backend)
      }
    }

    // Documentación — solo DOCUMENTACION y JEFE_TALLER
    match /documentations/{docId} {
      allow read, write: if hasRole('DOCUMENTACION') || hasRole('JEFE_TALLER');
    }

    // Usuarios — cada usuario puede leer el suyo, JEFE_TALLER gestiona todos
    match /users/{uid} {
      allow read: if request.auth.uid == uid || hasRole('JEFE_TALLER');
      allow write: if hasRole('JEFE_TALLER');
    }

    // Notificaciones — cada usuario lee las suyas
    match /notifications/{notificationId} {
      allow read: if request.auth != null
        && (resource.data.targetUid == request.auth.uid
            || resource.data.targetRole == request.auth.token.role);
      allow write: if false;  // Solo desde backend
    }
  }
}
```

---

## 5. Trazabilidad de Fechas en Cards de Vehículo

Todo card de vehículo (web y móvil) debe mostrar las fechas clave de trazabilidad en una sección de historial visual:

```
┌──────────────────────────────────────┐
│  KIA Sportage - Blanco               │
│  Chasis: 9BFPK62M0PB001234           │
│  Estado: En Instalación              │
├──────────────────────────────────────┤
│  📅 TRAZABILIDAD                      │
│  ✅ Recepcionado:  23/02/2026 08:00  │
│  ✅ Certificado:   23/02/2026 08:45  │
│  ✅ Documentado:   23/02/2026 10:00  │
│  ✅ OT Generada:   23/02/2026 11:00  │
│  ⏳ Instalando...                    │
│  — Listo para Entrega                │
│  — Entregado                         │
└──────────────────────────────────────┘
```

Estas fechas se obtienen del documento `vehicle` (campos `receptionDate`, `certificationDate`, etc.) y se muestran progresivamente conforme el vehículo avanza en el flujo. Los estados futuros se muestran con "—" y los activos con "⏳".