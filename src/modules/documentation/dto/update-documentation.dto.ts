import { PartialType } from '@nestjs/swagger';
import { CreateDocumentationDto } from './create-documentation.dto';

/**
 * DTO para PATCH /documentation/:vehicleId.
 *
 * Extiende CreateDocumentationDto con todos los campos opcionales,
 * preservando los decoradores @Transform, @IsArray, @ValidateNested, etc.
 * de la clase base. Esto garantiza que class-transformer aplique el @Transform
 * de `accessories` (parseo de JSON string → AccessoryItemDto[]) en requests
 * multipart/form-data.
 *
 * IMPORTANTE: No usar `Partial<CreateDocumentationDto>` como anotación de tipo
 * en el controlador porque TypeScript utility types no existen en runtime
 * y class-transformer no puede aplicar los decoradores de la clase base.
 */
export class UpdateDocumentationDto extends PartialType(
  CreateDocumentationDto,
) {}
