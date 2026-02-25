import { RoleEnum } from '../enums/role.enum';
import { SedeEnum } from '../enums/sede.enum';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: RoleEnum;
  sede: SedeEnum;
  active: boolean;
  displayName?: string;
}
