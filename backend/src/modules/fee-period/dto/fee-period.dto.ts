import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFeePeriodDto {
  @ApiProperty({ example: 'FP2026A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: '2026年秋季学期' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsString()
  @IsNotEmpty()
  start_date!: string;

  @ApiProperty({ example: '2027-01-31' })
  @IsString()
  @IsNotEmpty()
  end_date!: string;

  @ApiProperty({ description: '所属校区 ID（收费期只绑定单个校区）' })
  @IsString()
  @IsNotEmpty()
  campus_id!: string;
}

export class UpdateFeePeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  end_date?: string;

  @ApiPropertyOptional({ enum: ['draft', 'open', 'closed'], description: '只允许 draft→open→closed 单向流转' })
  @IsOptional()
  @IsIn(['draft', 'open', 'closed'])
  status?: 'draft' | 'open' | 'closed';

  @ApiPropertyOptional({ description: '所属校区 ID（仅无账单且无收费项目绑定时可变更）' })
  @IsOptional()
  @IsString()
  campus_id?: string;
}
