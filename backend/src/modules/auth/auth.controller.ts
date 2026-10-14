import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AdminLoginDto, BindDto, ChangePasswordDto, ExchangeCodeDto, PhoneLoginDto, STUDENT_SESSION_COOKIE } from './dto/auth.dto';
import { Public } from '../../common/decorators/auth.decorators';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ClientIp, CurrentUser, RequestId } from '../../common/decorators/request.decorators';
import { AdminUserInfo } from '../../common/types';

@ApiTags('认证')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 从 Cookie 或 Authorization 头提取学生会话令牌 */
  private extractSessionToken(req: Request): string | null {
    const fromCookie = (req as any).cookies?.[STUDENT_SESSION_COOKIE];
    if (fromCookie) return fromCookie;
    const h = req.headers?.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
  }

  @Public()
  @Post('admin/auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员登录' })
  adminLogin(@Body() dto: AdminLoginDto, @ClientIp() ip: string, @RequestId() requestId: string) {
    return this.auth.adminLogin(dto, ip, requestId);
  }

  @Post('admin/auth/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard, RolesGuard)
  @ApiOperation({ summary: '管理员登出' })
  adminLogout(
    @CurrentUser() user: AdminUserInfo,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.auth.adminLogout(user.id, requestId, ip);
  }

  @Post('admin/auth/change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtGuard, RolesGuard)
  @ApiOperation({ summary: '修改自己的登录密码' })
  changePassword(
    @CurrentUser() user: AdminUserInfo,
    @Body() dto: ChangePasswordDto,
    @RequestId() requestId: string,
    @ClientIp() ip: string,
  ) {
    return this.auth.changePassword(user.id, dto.old_password, dto.new_password, requestId, ip);
  }

  @Public()
  @Post('auth/code/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '学生端：验证登录码（第1步）' })
  exchange(@Body() dto: ExchangeCodeDto, @ClientIp() ip: string, @RequestId() requestId: string) {
    return this.auth.exchangeCode(dto, ip, requestId);
  }

  @Public()
  @Post('auth/bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '学生端：确认绑定并建立会话（第2步，下发 Cookie）' })
  bind(
    @Body() dto: BindDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string,
    @RequestId() requestId: string,
  ) {
    // 已有会话（多孩子追加绑定）从 Cookie / Authorization 头读取
    const existing = this.extractSessionToken(req);
    return this.auth.bind(dto, existing, res, ip, requestId);
  }

  @Public()
  @Post('auth/phone-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '学生端：手机号登录（一个手机号可对应多个学生）' })
  phoneLogin(
    @Body() dto: PhoneLoginDto,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string,
    @RequestId() requestId: string,
  ) {
    return this.auth.phoneLogin(dto, res, ip, requestId);
  }

  @Post('auth/mp-bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '学生端：小程序 code 换 openid 并绑定到当前会话的家长' })
  mpBind(
    @Body() dto: { code: string },
    @Headers('authorization') auth: string | undefined,
    @RequestId() requestId: string,
  ) {
    return this.auth.mpBind(dto.code, auth, requestId);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '学生端：退出会话' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.extractSessionToken(req), res);
    return { ok: true };
  }
}
