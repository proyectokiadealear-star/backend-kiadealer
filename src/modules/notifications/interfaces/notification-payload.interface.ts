import { RoleEnum } from '../../../common/enums/role.enum';
import { SedeEnum } from '../../../common/enums/sede.enum';

export interface NotificationPayload {
  type: string;
  targetRole: RoleEnum;
  targetSede: string | SedeEnum;
  title: string;
  body: string;
  vehicleId?: string;
  chassis?: string;
  data?: Record<string, string>;
}
