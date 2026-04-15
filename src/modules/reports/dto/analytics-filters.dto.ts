import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const DATE_DD_MM_YYYY_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

@ValidatorConstraint({ name: 'DateRangeConstraint', async: false })
class DateRangeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args?: ValidationArguments): boolean {
    if (!args?.object) return true;
    const dto = args.object as AnalyticsFiltersDto;
    if (!dto.dateFrom || !dto.dateTo) return true;
    const from = parseDateOrNull(dto.dateFrom, false);
    const to = parseDateOrNull(dto.dateTo, true);
    if (!from || !to) return false;
    return from.getTime() <= to.getTime();
  }

  defaultMessage(): string {
    return 'dateFrom debe ser menor o igual a dateTo';
  }
}

export class AnalyticsFiltersDto {
  @IsOptional()
  @IsString()
  sede?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'], {
    message: 'groupBy debe ser day, week o month',
  })
  groupBy?: 'day' | 'week' | 'month';

  @IsOptional()
  @Matches(DATE_DD_MM_YYYY_REGEX, {
    message: 'dateFrom debe tener formato dd/MM/yyyy',
  })
  dateFrom?: string;

  @IsOptional()
  @Matches(DATE_DD_MM_YYYY_REGEX, {
    message: 'dateTo debe tener formato dd/MM/yyyy',
  })
  @Validate(DateRangeConstraint)
  dateTo?: string;
}

function parseDateOrNull(value: string, endOfDay: boolean): Date | null {
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  const iso = `${year}-${month}-${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const utcDay = String(date.getUTCDate()).padStart(2, '0');
  const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const utcYear = String(date.getUTCFullYear());
  const reconstructed = `${utcDay}/${utcMonth}/${utcYear}`;
  return reconstructed === value ? date : null;
}
