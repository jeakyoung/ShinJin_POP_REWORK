package com.shinjin.pop.planning;

import com.shinjin.pop.processgroup.ProcessGroupController;
import com.shinjin.pop.workorders.WorkOrderFixtures;
import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.basket.BasketDemoController;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import synthetic.planning.PlanningDomain;
import synthetic.planning.PlanningDomain.*;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/process1/planning")
public final class ProcessPlanController {
    public record StockLink(PlanKey target, MaterialKey source) {}
    public record ScanRow(PlanKey key,boolean finished,BigDecimal reworkQuantity) {}
    public record OrderMeta(OrderKey key, String month, BigDecimal stock, BigDecimal inProcess,Boolean defaultListed) {}
    public record SiteCatalog(String site, LocalDate date, String plantCode, String workCode, String process,
                              List<String> warehouses, List<String> qualities, List<StockLink> stock, List<OrderMeta> orders, List<ScanRow> scans) {
        public SiteCatalog {scans=scans==null?List.of():List.copyOf(scans);}
        public boolean isDirectApply() {return "001".equals(workCode) || "000001".equals(plantCode);}
    }
    public record Catalog(List<SiteCatalog> sites) {}
    public record Count(PlanKey key, int count) {}
    public record Screen(View planning, SiteCatalog catalog, List<Count> prints, List<String> parentQualities) {}
    public record Attach(String requestId, Long expectedRevision, List<PlanKey> plans) {}
    public record AttachResult(List<PlanKey> attached,List<String> skipped) {}
    private record Receipt(Actor actor, Attach command, AttachResult result) {}
    public record Password(String password) {}
    private static final String GRANT = ProcessPlanController.class.getName() + ".administrator";
    private final PlanningDomain planning;
    private final WorkOrderFixtures work;
    private final PlanningOutputController reports;
    private final TerminalSettingsDemoController settings;
    private final ProcessPlanCatalog catalog;
    private final String managementPassword;
    private final Map<String,Receipt> receipts = new HashMap<>();
    public record PublicationRequest(String requestId,Long expectedRevision,List<Command> rows,List<PlanKey> parentPlans) {
        public PublicationRequest {parentPlans=parentPlans==null?List.of():List.copyOf(parentPlans);}
    }
    private record Publication(Actor actor,PublicationRequest command) {}
    private final Map<String,Publication> publications=new HashMap<>();
    private final BasketDemoController baskets;
    private final ProcessGroupController groups;

    public ProcessPlanController(PlanningDemoController controller, WorkOrderFixtures work, PlanningOutputController reports, TerminalSettingsDemoController settings,
            ProcessPlanCatalog catalog,BasketDemoController baskets,ProcessGroupController groups, @Value("${shinjin.demo.process1-management-password:demo-only}") String managementPassword) {
        planning = controller.domain();
        this.work = work;
        this.reports = reports;
        this.settings = settings;
        this.managementPassword = managementPassword;
        this.catalog=catalog;
        this.baskets=baskets;
        this.groups=groups;
    }
    private static ResponseEntity<?> response(int status, Object body) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body);
    }
    private static ResponseEntity<?> failure(int status, String code) {
        return response(status, Map.of("code", code));
    }

    @GetMapping
    public ResponseEntity<?> screen(HttpServletRequest request) {
        var actor = PlanningDemoController.actor(request);
        synchronized (planning) {
            var result = planning.view(actor, new Filter(null,null,null,null));
            if (result.status() != 200) return failure(result.status(),result.error());
            var cfg = catalog.selectedSite(actor,request);
            if (cfg == null) return failure(403,"TERMINAL_OUT_OF_SCOPE");
            List<Count> counts = new ArrayList<>();
            for (Plan plan : result.value().plans()) {
                var report = planning.processPreview(actor, new PlanOutputSelection(actor.site(), OutputMode.SINGLE, List.of(plan.key())));
                if (report.status() == 200) counts.add(new Count(plan.key(), report.value().rows().get(0).printCount()));
            }
            return response(200,new Screen(result.value(), cfg, counts, work.qualities(actor.terminal())));
        }
    }

    public record PrintReceipt(PlanOutput report,String device,byte[] pdf) {}
    private record PrintKey(Actor actor,String id) {}
    private final Map<PrintKey,PrintReceipt> printed=new HashMap<>();
    @PostMapping("/output")
    public ResponseEntity<?> print(HttpServletRequest request,@RequestBody PlanOutputCommand command) {
        var actor=PlanningDemoController.actor(request);
        synchronized(planning) {
            var before=planning.processOutput(actor,command,false);
            if(before.status()!=200)return failure(before.status(),before.error());
            var receiptKey=new PrintKey(actor,command.requestId());
            var previous=printed.get(receiptKey);
            if(previous!=null)return response(200,previous);
            var applied=settings.appliedValues(DemoSessionController.requireIdentity(request),request);
            String device=applied.outputs().get("document");
            if(device==null || "NONE".equals(device))return failure(422,"DOCUMENT_PRINTER_NOT_CONFIGURED");
            var document=reports.render(before.value());
            if(document.pdf()==null)return failure(503,document.contract().status());
            var result=planning.processOutput(actor,command,true);
            if(result.status()!=200)return failure(result.status(),result.error());
            var receipt=new PrintReceipt(result.value(),device,document.pdf());
            printed.put(receiptKey,receipt);
            return response(200,receipt);
        }
    }

    @PostMapping("/publish")
    public ResponseEntity<?> publish(HttpServletRequest request,@RequestBody PublicationRequest input) {
        var actor=PlanningDemoController.actor(request);
        var center=DemoSessionController.requireIdentity(request).workCenterCode();
        boolean groupCenter="005".equals(center)||"105".equals(center);
        var cfg=groupCenter?catalog.selectedSite(actor,request):catalog.site(actor);
        synchronized(planning) {
            if(cfg==null)return failure(403,"TERMINAL_OUT_OF_SCOPE");
            if(input==null || input.requestId()==null || input.rows()==null || input.rows().isEmpty() || input.parentPlans().size()>100)return failure(422,"INVALID_BATCH");
            var batch=new BatchCommand(input.requestId(),input.expectedRevision(),input.rows());
            var prior=publications.get(batch.requestId());
            if(prior!=null) {
                if(!actor.equals(prior.actor()))return failure(403,"COMMAND_ACTOR_MISMATCH");
                if(!input.equals(prior.command()))return failure(409,"REQUEST_ID_REUSED");
            } else {
                var view=planning.view(actor,new Filter(null,null,null,null));
                if(view.status()!=200||!view.value().canWrite())return failure(403,"TERMINAL_OUT_OF_SCOPE");
                boolean basketCenter="003".equals(center)||"103".equals(center);
                var parentQualities=groupCenter?groups.parentQualities(request):basketCenter?baskets.parentQualities(request,input.parentPlans().stream().map(
                    k->new synthetic.basket.BasketDomain.PlanKey(k.date(),k.sequence())).toList()):work.qualities(actor.terminal());
                for(var row:batch.rows()) {
                    if(row==null || row.action()==null)return failure(422,"INVALID_BATCH");
                    if(row.action()==Action.CHANGE_SPEC) {
                        if(!cfg.stock().contains(new StockLink(row.targetPlan(),row.sourceMaterial())))return failure(422,"MATERIAL_SPEC_MISMATCH");
                    } else {
                        var order=view.value().orders().stream().filter(o->o.key().equals(row.originalOrder())).findFirst().orElse(null);
                        if(order==null)return failure(404,"ORDER_NOT_FOUND");
                        if(parentQualities.stream()
                            .anyMatch(q->!order.spec().quality().equals(q)))return failure(409,"QUALITY_OUT_OF_SCOPE");
                    }
                }
            }
            var result=planning.batch(actor,batch);
            if(result.status()!=200)return failure(result.status(),result.error());
            publications.put(batch.requestId(),new Publication(actor,input));
            return response(200,result.value());
        }
    }

    @PostMapping("/administrator")
    public ResponseEntity<?> administrator(HttpServletRequest request, @RequestBody Password input) {
        var actor = PlanningDemoController.actor(request);
        var result = planning.view(actor,new Filter(null,null,null,null));
        var session = request.getSession();
        session.removeAttribute(GRANT);
        if (result.status()!=200 || !result.value().canWrite() || input == null || input.password() == null
                || managementPassword.isBlank() || !managementPassword.equals(input.password())) return failure(403,"ADMIN_PASSWORD_REQUIRED");
        session.setAttribute(GRANT, actor);
        return response(200,Map.of("granted",true));
    }

    @PostMapping("/management")
    public ResponseEntity<?> management(HttpServletRequest request, @RequestBody ManagementCommand input) {
        var actor = PlanningDemoController.actor(request);
        if (!actor.equals(request.getSession().getAttribute(GRANT))) return failure(403,"ADMIN_PASSWORD_REQUIRED");
        var result = planning.addManagement(actor,input);
        return result.status()==200?response(200,result.value()):failure(result.status(),result.error());
    }

    @PostMapping("/attach")
    public ResponseEntity<?> attach(HttpServletRequest request, @RequestBody Attach input) {
        var centerCode = DemoSessionController.requireIdentity(request).workCenterCode();
        if ("005".equals(centerCode) || "105".equals(centerCode)) return failure(403,"DIRECT_APPLY_UNAVAILABLE");
        var actor = PlanningDemoController.actor(request);
        var cfg = catalog.selectedSite(actor,request);
        var center=DemoSessionController.requireIdentity(request).workCenterCode();
        synchronized (planning) {
            var result = planning.view(actor,new Filter(null,null,null,null));
            if (cfg==null || "003".equals(center)||"103".equals(center)||!cfg.isDirectApply() || result.status()!=200 || !result.value().canWrite()) return failure(403,"TERMINAL_OUT_OF_SCOPE");
            if (input == null || input.requestId()==null || input.requestId().isBlank() || input.requestId().length()>128
                    || input.expectedRevision()==null || input.plans()==null || input.plans().isEmpty()) return failure(422,"INVALID_COMMAND");
            var prior = receipts.get(input.requestId());
            if (prior!=null) {
                if (!prior.actor().equals(actor)) return failure(403,"COMMAND_ACTOR_MISMATCH");
                return prior.command().equals(input)?response(200,prior.result()):failure(409,"REQUEST_ID_REUSED");
            }
            if (result.value().revision()!=input.expectedRevision()) return failure(409,"STALE_REVISION");
            if(new java.util.HashSet<>(input.plans()).size()!=input.plans().size() || input.plans().size()>100)return failure(422,"INVALID_COMMAND");
            var selected = new LinkedHashMap<PlanKey,Plan>();
            for(var key:input.plans()){
                var p=result.value().plans().stream().filter(row->row.key().equals(key)).findFirst().orElse(null);
                if(p==null)return failure(404,"PLAN_NOT_FOUND");
                selected.put(key,p);
            }
            synchronized(work) {
                var attached=new ArrayList<PlanKey>();var skipped=new ArrayList<String>();
                for(var plan:selected.values()){
                    if(!cfg.qualities().contains(plan.spec().quality())){skipped.add("QUALITY_OUT_OF_SCOPE");continue;}
                    if(work.hasPlan(actor.terminal(),plan.key())){skipped.add("ALREADY_ATTACHED");continue;}
                    var scan=cfg.scans().stream().filter(r->r.key().equals(plan.key())).findFirst().orElse(null);
                    boolean finished=scan==null?plan.status()==Status.COMPLETED:scan.finished() && scan.reworkQuantity().compareTo(BigDecimal.ONE)<0;
                    var candidate=plan;
                    if(finished){
                        var view=planning.view(actor,new Filter(null,null,null,null)).value();
                        var order=view.orders().stream().filter(o->o.key().equals(plan.originalOrder())).findFirst().orElse(null);
                        if(order==null || order.ordered().compareTo(order.issued())<=0){skipped.add("COMPLETED_PLAN");continue;}
                        String id=java.util.UUID.nameUUIDFromBytes((input.requestId()+"/"+plan.key()).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
                        var issued=planning.execute(actor,new Command(Action.REVERSE_ISSUE,id,view.revision(),order.key(),null,
                                plan.warehouse(),order.ordered().subtract(order.issued()),null,null,null));
                        if(issued.status()!=200){skipped.add(issued.error());continue;}
                        candidate=issued.value().plan();
                    }
                    attached.addAll(work.attachPlanned(actor.terminal(),cfg.process(),List.of(candidate)));
                }
                if(attached.isEmpty())return failure(409,skipped.get(0));
                var resultRows=new AttachResult(List.copyOf(attached),List.copyOf(skipped));
                receipts.put(input.requestId(),new Receipt(actor,input,resultRows));
                return response(200,resultRows);
            }
        }
    }
}
