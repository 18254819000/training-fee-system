import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateReservationCourseDto {
  @ApiProperty({ description: '所属校区 ID（预约课程只属于一个校区，与收费项目一致）' })
  @IsString() @IsNotEmpty()
  campus_id!: string;
  @ApiProperty({ example: '日语 N5 零基础班' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ example: 128000, description: '价格（分），必须为正整数' })
  @IsInt() @Min(1)
  amount_fen!: number;
  @ApiProperty({ description: '购买截止时间（ISO 字符串；超过该时刻即到期，不可购买）' })
  @IsDateString()
  deadline!: string;
}

export class UpdateReservationCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: 128000, description: '价格（分），必须为正整数' })
  @IsOptional() @IsInt() @Min(1)
  amount_fen?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() deadline?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class ReservationCourseQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
  @ApiPropertyOptional({ description: '所属校区 ID' }) @IsOptional() @IsString() campus_id?: string;
}

export class PurchaseReservationCourseDto {
  @ApiProperty({ description: '购买所用的学员 ID（须在当前会话绑定范围内）' })
  @IsString() @IsNotEmpty()
  student_id!: string;
}
