package com.shinjin.pop.drawing;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.planning.PlanningOutputController;
import com.shinjin.pop.planning.ProcessPlanController.*;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import synthetic.drawing.DrawingDomain;
import synthetic.drawing.InMemoryDrawingDomain;
import synthetic.planning.InMemoryPlanningDomain;
import synthetic.planning.PlanningDomain.*;
import tools.jackson.databind.ObjectMapper;

/** frmProcess7 passes its own grids and work code into the shared planning dialog. */
@RestController
@Profile("demo")
@RequestMapping("/api/drawing-008/planning")
public class DrawingPlanningController {
    record MaterialRow(String lot,String position,BigDecimal quantity) {}
    record SourceSite(String factory,String plant,List<String> terminals,String warehouse,
                      Map<String,BigDecimal> unissued,Map<String,MaterialRow> stock) {}
    record Source(LocalDate date,List<SourceSite> sites) {}
    private record Scope(Site site,SiteCatalog catalog,Map<OrderKey,DrawingController.DisplayFields> fields) {}
    private record Request(Actor actor,String id) {}
    private record Attached(Attach command,AttachResult result) {}
    private final Map<String,Scope> scopes = new HashMap<>();
    private final Map<Request,Attached> attachments = new HashMap<>();
    private final Map<Request,PrintReceipt> prints = new HashMap<>();
    private final InMemoryPlanningDomain planning;
    private final InMemoryDrawingDomain drawing;
    private final DrawingController screens;
    private final TerminalSettingsDemoController settings;
    private final PlanningOutputController output;
    private final String password;
    private static final String GRANT = DrawingPlanningController.class.getName()+".grant";

    DrawingPlanningController(DrawingController screens,InMemoryDrawingDomain drawing,TerminalSettingsDemoController settings,
            PlanningOutputController output,ObjectMapper mapper,
            @Value("${shinjin.demo.drawing-planning:classpath:demo/drawing-planning.json}") Resource input,
            @Value("${shinjin.demo.drawing-planning-management-password:}") String password) throws IOException {
        this.screens=screens;this.drawing=drawing;this.settings=settings;this.output=output;this.password=password;
        Source source;
        try (var stream=input.getInputStream()) { source=mapper.readValue(stream,Source.class); }
        var seeds=new HashMap<Site,Seed>();
        for (var row:source.sites()) {
            Site site=new Site(row.factory(),row.plant(),"008");
            var orders=new ArrayList<Order>();var plans=new ArrayList<Plan>();var materials=new ArrayList<Material>();
            var items=new HashMap<Spec,String>();var meta=new ArrayList<OrderMeta>();var stock=new ArrayList<StockLink>();
            var fields=new LinkedHashMap<OrderKey,DrawingController.DisplayFields>();
            var qualities=new LinkedHashSet<String>();var terminals=new HashMap<String,Boolean>();
            for (var seed:DrawingController.planningSeeds()) {
                var key=seed.key();var f=screens.fields(key);
                if (!key.factory().equals(row.factory()) || !key.site().equals(row.plant()) || f==null) continue;
                var order=new OrderKey(f.orderNumber(),0,f.orderSequence());
                var pk=new PlanKey(key.date(),key.sequence());
                String idx=key.date().format(DateTimeFormatter.BASIC_ISO_DATE)+"/"+key.sequence();
                var spec=new Spec(f.material(),WorkState.CUT,f.thickness(),f.width(),f.length());
                var issued=seed.orderQuantity();
                orders.add(new Order(order,f.customer(),seed.item(),spec,row.warehouse(),issued.add(row.unissued().getOrDefault(idx,BigDecimal.ZERO)),issued));
                plans.add(new Plan(pk,Branch.STANDARD,Status.PLANNED,order,null,order,seed.item(),spec,row.warehouse(),issued,BigDecimal.ZERO,null,null));
                meta.add(new OrderMeta(order,YearMonth.from(source.date()).toString(),BigDecimal.ZERO,BigDecimal.ZERO,true));
                fields.put(order,f);items.put(spec,seed.item());qualities.add(f.material());
                var lot=row.stock().get(idx);
                if (lot!=null) {
                    var material=new MaterialKey(seed.item(),lot.lot(),row.warehouse(),lot.position());
                    materials.add(new Material(material,spec,lot.quantity()));
                    stock.add(new StockLink(pk,material));
                }
            }
            row.terminals().forEach(terminal->terminals.put(terminal,true));
            var catalog=new SiteCatalog(row.plant(),source.date(),row.plant(),"008","도면가공",List.of(row.warehouse()),
                    List.copyOf(qualities),List.copyOf(stock),List.copyOf(meta),List.of());
            var scope=new Scope(site,catalog,Map.copyOf(fields));
            row.terminals().forEach(terminal->scopes.put(terminal,scope));
            seeds.put(site,new Seed(terminals,Set.of(row.warehouse()),orders,plans,materials,items));
        }
        planning=new InMemoryPlanningDomain(Clock.fixed(source.date().atStartOfDay(ZoneOffset.UTC).toInstant(),ZoneOffset.UTC),seeds);
    }

    private Actor actor(HttpServletRequest request) {
        var user=DrawingController.session(request);var scope=scopes.get(user.terminal());
        if (scope==null || !scope.site().factory().equals(user.factory()) || !scope.site().site().equals(user.site()))
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN);
        return new Actor(scope.site(),user.terminal(),user.operator());
    }
    private static ResponseEntity<?> reply(int status,Object value) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(value);
    }
    private static ResponseEntity<?> fail(int status,String code) { return reply(status,Map.of("code",code)); }
    private View view(Actor actor) {return planning.view(actor,new Filter(null,null,null,null)).value();}
    private List<String> allowed(HttpServletRequest request) {
        return settings.appliedValues(DemoSessionController.requireIdentity(request),request).materials();
    }

    @GetMapping
    synchronized ResponseEntity<?> list(HttpServletRequest request) {
        var actor=actor(request);var result=view(actor);var counts=new ArrayList<Count>();
        for (var plan:result.plans()) {
            var preview=planning.processPreview(actor,new PlanOutputSelection(actor.site(),OutputMode.SINGLE,List.of(plan.key())));
            if(preview.status()==200) counts.add(new Count(plan.key(),preview.value().rows().get(0).printCount()));
        }
        return reply(200,new Screen(result,scopes.get(actor.terminal()).catalog(),counts,allowed(request)));
    }

    @PostMapping("/publish")
    synchronized ResponseEntity<?> publish(HttpServletRequest request,@RequestBody BatchCommand input) {
        var actor=actor(request);var scope=scopes.get(actor.terminal());
        if(input.rows()==null || input.rows().isEmpty() || input.rows().stream().anyMatch(Objects::isNull))return fail(422,"INVALID_BATCH");
        var allowed=allowed(request);var before=view(actor);
        for(var cmd:input.rows()) {
            if(cmd.action()==Action.CHANGE_SPEC && !scope.catalog().stock().contains(new StockLink(cmd.targetPlan(),cmd.sourceMaterial())))
                return fail(422,"MATERIAL_SPEC_MISMATCH");
            var source=before.orders().stream().filter(row->row.key().equals(cmd.originalOrder())).findFirst();
            if(cmd.action()==Action.REVERSE_ISSUE && source.isPresent() && !allowed.contains(source.get().spec().quality()))
                return fail(422,"QUALITY_OUT_OF_SCOPE");
        }
        var result=planning.batch(actor,input);
        if(result.status()!=200)return fail(result.status(),result.error());
        for(var plan:result.value().plans()) {
            var f=scope.fields().get(plan.originalOrder());
            if(f==null) continue;
            var spec=plan.spec();
            var fields=new DrawingController.DisplayFields(plan.issuedOrder().number(),plan.issuedOrder().line(),f.customer(),
                    spec.quality(),f.kind(),f.dueDate(),spec.thickness(),spec.width(),spec.length(),f.returnWarehouse(),f.returnLocation(),null);
            screens.registerPlanned(drawingKey(actor,plan.key()),plan.item(),plan.quantity(),fields);
        }
        return reply(200,result.value());
    }

    private static DrawingDomain.PlanKey drawingKey(Actor actor,PlanKey key) {
        return new DrawingDomain.PlanKey(actor.site().factory(),actor.site().site(),key.date(),key.sequence());
    }

    @PostMapping("/attach")
    synchronized ResponseEntity<?> attach(HttpServletRequest request,@RequestBody Attach input) {
        var actor=actor(request);
        if(!scopes.get(actor.terminal()).catalog().isDirectApply())return fail(403,"ATTACH_UNAVAILABLE");
        if(input.requestId()==null || input.requestId().isBlank() || input.plans()==null || input.plans().isEmpty()
                || input.plans().stream().anyMatch(Objects::isNull))return fail(422,"INVALID_SELECTION");
        var req=new Request(actor,input.requestId());var prior=attachments.get(req);
        if(prior!=null)return prior.command().equals(input)?reply(200,prior.result()):fail(409,"REQUEST_ID_REUSED");
        var view=view(actor);if(!Objects.equals(input.expectedRevision(),view.revision()))return fail(409,"STALE_REVISION");
        var added=new ArrayList<PlanKey>();var skipped=new ArrayList<String>();
        for(var key:new LinkedHashSet<>(input.plans())) {
            var plan=view.plans().stream().filter(row->row.key().equals(key)).findFirst().orElse(null);
            if(plan==null)return fail(404,"PLAN_NOT_FOUND");
            if(!allowed(request).contains(plan.spec().quality())){skipped.add("QUALITY_OUT_OF_SCOPE");continue;}
            var snapshot=drawing.get(DrawingController.session(request),drawingKey(actor,key));
            if(snapshot.status()!=200)return fail(snapshot.status(),snapshot.error());
            if(snapshot.value().state()!=DrawingDomain.State.CUT_READY && snapshot.value().state()!=DrawingDomain.State.DRAW_READY){
                skipped.add("COMPLETED_PLAN");continue;
            }
            added.add(key);
        }
        if(added.isEmpty())return fail(409,skipped.get(0));
        var receipt=new AttachResult(List.copyOf(added),List.copyOf(skipped));attachments.put(req,new Attached(input,receipt));
        return reply(200,receipt);
    }

    @PostMapping("/administrator")
    ResponseEntity<?> unlock(HttpServletRequest request,@RequestBody Password input) {
        var actor=actor(request);request.getSession().removeAttribute(GRANT);
        if(password.isBlank() || !password.equals(input.password()))return fail(403,"ADMIN_PASSWORD_REQUIRED");
        request.getSession().setAttribute(GRANT,actor);return reply(200,Map.of("granted",true));
    }
    @PostMapping("/management")
    synchronized ResponseEntity<?> manage(HttpServletRequest request,@RequestBody ManagementCommand input) {
        var actor=actor(request);
        if(!actor.equals(request.getSession().getAttribute(GRANT)))return fail(403,"ADMIN_PASSWORD_REQUIRED");
        var result=planning.addManagement(actor,input);
        return result.status()==200?reply(200,result.value()):fail(result.status(),result.error());
    }
    @PostMapping("/output")
    synchronized ResponseEntity<?> print(HttpServletRequest request,@RequestBody PlanOutputCommand input) {
        var actor=actor(request);var checked=planning.processOutput(actor,input,false);
        if(checked.status()!=200)return fail(checked.status(),checked.error());
        var key=new Request(actor,input.requestId());var prior=prints.get(key);if(prior!=null)return reply(200,prior);
        String printer=settings.appliedValues(DemoSessionController.requireIdentity(request),request).outputs().get("document");
        if(printer==null || printer.equals("NONE"))return fail(422,"DOCUMENT_PRINTER_NOT_CONFIGURED");
        var rendered=output.render(checked.value());if(rendered.pdf()==null)return fail(503,rendered.contract().status());
        var result=planning.processOutput(actor,input,true);
        if(result.status()!=200)return fail(result.status(),result.error());
        var receipt=new PrintReceipt(result.value(),printer,rendered.pdf());prints.put(key,receipt);return reply(200,receipt);
    }
}
