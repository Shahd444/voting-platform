import {
  Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthedAdmin, ClientIp, CurrentAdmin, Roles } from '../auth/decorators';
import { AdminGuard } from '../auth/guards';
import { SessionService } from '../auth/session.service';
import { RateLimitService } from '../core/rate-limit.service';
import { requestOrigin } from '../common/request-origin';
import { ResultsService } from '../results/results.service';
import {
  AccessSettingsDto, CategoryDto, ChangePasswordDto, CodeDto, CreateUserDto, DisableMfaDto, DisplaySettingsDto,
  EventSettingsDto, ExhibitorFormDto, LoginDto, ResetDto, RestartDto, VotingSettingsDto,
} from './admin.dto';
import { AdminAuthService } from './admin-auth.service';
import { CatalogService, UploadedImage } from './catalog.service';
import { EventService } from './event.service';
import { ReportsService, stamp } from './reports.service';

const actor = (a: AuthedAdmin) => `admin:${a.username}`;
const photoUpload = FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

/** Sign-in, MFA, team accounts. */
@Controller('api/admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService, private readonly sessions: SessionService, private readonly limits: RateLimitService) {}

  @Post('login')
  @HttpCode(200)
  async login(@ClientIp() ip: string, @Body() b: LoginDto, @Res({ passthrough: true }) res: Response) {
    await this.limits.check('admin-login', ip, 10, 300);
    return this.auth.login(res, ip, b.username, b.password);
  }

  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(@ClientIp() ip: string, @Req() req: Request, @Body() b: CodeDto, @Res({ passthrough: true }) res: Response) {
    await this.limits.check('admin-mfa', ip, 10, 300);
    return this.auth.loginMfa(res, ip, this.sessions.read(req, 'mc_ap', 'admin_pending'), b.code);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res, 'mc_a');
    this.sessions.clear(res, 'mc_ap');
    return { ok: true };
  }

  @Get('me') @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AuthedAdmin) { return { admin }; }

  @Post('password') @HttpCode(200) @UseGuards(AdminGuard)
  password(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.changePassword(res, ip, a, b.current, b.next);
  }

  @Post('mfa/setup') @HttpCode(200) @UseGuards(AdminGuard)
  mfaSetup(@CurrentAdmin() a: AuthedAdmin) { return this.auth.mfaSetup(a); }

  @Post('mfa/enable') @HttpCode(200) @UseGuards(AdminGuard)
  mfaEnable(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: CodeDto) { return this.auth.mfaEnable(ip, a, b.code); }

  @Post('mfa/disable') @HttpCode(200) @UseGuards(AdminGuard)
  mfaDisable(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: DisableMfaDto) { return this.auth.mfaDisable(ip, a, b.password, b.code); }

  @Get('users') @UseGuards(AdminGuard) @Roles('admin')
  async users() { return { users: await this.auth.listUsers() }; }

  @Post('users') @UseGuards(AdminGuard) @Roles('admin')
  createUser(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: CreateUserDto) { return this.auth.createUser(ip, a, b.username, b.password, b.role); }

  @Delete('users/:id') @UseGuards(AdminGuard) @Roles('admin')
  deleteUser(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Param('id', ParseIntPipe) id: number) { return this.auth.deleteUser(ip, a, id); }
}

/** Exhibitors and categories (F9). Writes require the full admin role. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  async categories() { return { categories: await this.catalog.listCategories() }; }

  @Post('categories') @Roles('admin')
  createCategory(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: CategoryDto) { return this.catalog.createCategory(actor(a), ip, b); }

  @Put('categories/:id') @Roles('admin')
  updateCategory(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Param('id', ParseIntPipe) id: number, @Body() b: CategoryDto) {
    return this.catalog.updateCategory(actor(a), ip, id, b);
  }

  @Delete('categories/:id') @Roles('admin')
  deleteCategory(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Param('id', ParseIntPipe) id: number, @Query('force') force?: string) {
    return this.catalog.deleteCategory(actor(a), ip, id, force === 'true');
  }

  @Get('exhibitors')
  async exhibitors() { return { exhibitors: await this.catalog.listExhibitors() }; }

  @Post('exhibitors') @Roles('admin') @UseInterceptors(photoUpload)
  createExhibitor(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: ExhibitorFormDto, @UploadedFile() file?: UploadedImage) {
    return this.catalog.createExhibitor(actor(a), ip, b, file);
  }

  @Put('exhibitors/:id') @Roles('admin') @UseInterceptors(photoUpload)
  updateExhibitor(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Param('id', ParseIntPipe) id: number, @Body() b: ExhibitorFormDto,
    @UploadedFile() file?: UploadedImage, @Query('force') force?: string) {
    return this.catalog.updateExhibitor(actor(a), ip, id, b, file, force === 'true');
  }

  @Delete('exhibitors/:id') @Roles('admin')
  deleteExhibitor(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Param('id', ParseIntPipe) id: number, @Query('force') force?: string) {
    return this.catalog.deleteExhibitor(actor(a), ip, id, force === 'true');
  }
}

/** Event details, voting window (F10), on-site access (F11), display key, links/QR. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class EventController {
  constructor(private readonly event: EventService) {}

  @Get('settings')
  settings(@ClientIp() ip: string, @Req() req: Request) {
    const networks = (req.get('x-event-lan-networks') || '').split(',').map((value) => value.trim()).filter(Boolean);
    return this.event.get(ip, networks);
  }

  @Put('settings/event') @Roles('admin')
  updateEvent(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: EventSettingsDto) { return this.event.updateEvent(actor(a), ip, b); }

  @Put('settings/voting') @Roles('admin')
  updateVoting(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: VotingSettingsDto) { return this.event.updateVoting(actor(a), ip, b); }

  @Put('settings/access') @Roles('admin')
  updateAccess(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: AccessSettingsDto) { return this.event.updateAccess(actor(a), ip, b); }

  @Put('settings/display') @Roles('admin')
  updateDisplay(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: DisplaySettingsDto) { return this.event.updateDisplay(actor(a), ip, b); }

  @Post('display/rotate') @HttpCode(200) @Roles('admin')
  rotate(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin) { return this.event.rotateDisplayKey(actor(a), ip); }

  @Get('links')
  @Header('Cache-Control', 'no-store')
  links(@CurrentAdmin() a: AuthedAdmin, @Req() req: Request) { return this.event.links(a.role === 'admin', requestOrigin(req)); }
}

/** Results, exports (F13), reset, visitors (F14), stats and audit log. */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly results: ResultsService,
    private readonly auth: AdminAuthService, private readonly limits: RateLimitService) {}

  @Get('results')
  results_() { return this.results.snapshot(true); }

  @Get('export/results.csv')
  async resultsCsv(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Res() res: Response) {
    const csv = await this.reports.resultsCsv(actor(a), ip);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="mc2026-results-${stamp()}.csv"`).send(csv);
  }

  @Get('export/results.json')
  async resultsJson(@Res() res: Response) {
    res.set('Content-Disposition', `attachment; filename="mc2026-results-${stamp()}.json"`).json(await this.results.snapshot(true));
  }

  @Post('results/reset') @HttpCode(200) @Roles('admin')
  async reset(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: ResetDto) {
    await this.limits.check('results-reset-password', ip, 10, 300, 'Too many password attempts. Try again later.');
    await this.auth.verifyCurrentPassword(a, b.password);
    return this.reports.reset(actor(a), ip, b.purgeVisitors === true);
  }

  @Post('results/restart') @HttpCode(200) @Roles('admin')
  restart(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Body() b: RestartDto) { return this.reports.restart(actor(a), ip, b.confirm); }

  @Get('visitors') @Roles('admin')
  @Header('Cache-Control', 'no-store')
  visitors(@Query('limit') limit?: string, @Query('offset') offset?: string) { return this.reports.visitors(limit, offset); }

  @Get('export/visitors.csv') @Roles('admin')
  @Header('Cache-Control', 'no-store')
  async visitorsCsv(@ClientIp() ip: string, @CurrentAdmin() a: AuthedAdmin, @Query('consented') consented: string, @Res() res: Response) {
    const csv = await this.reports.visitorsCsv(actor(a), ip, consented === 'true');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="mc2026-visitors-${stamp()}.csv"`).send(csv);
  }

  @Get('stats')
  stats() { return this.reports.stats(); }

  @Get('audit') @Roles('admin')
  @Header('Cache-Control', 'no-store')
  audit() { return this.reports.auditLog(); }
}
