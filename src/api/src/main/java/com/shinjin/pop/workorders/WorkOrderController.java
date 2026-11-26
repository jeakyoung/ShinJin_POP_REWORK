package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.output.SyntheticOutput;
import com.shinjin.pop.planning.ProcessPlanCatalog;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.context.annotation.Profile;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/work-orders")
public class WorkOrderController {
    public record Command(WorkOrderFixtures.Action action, BigDecimal actualQuantity, Long expectedRevision,
            String lotCode, BigDecimal quantity, String warehouse, String location) {}
    private final WorkOrderFixtures fixtures;

    private final TerminalSettingsDemoController settings;
    private final SyntheticOutput output;
    private final ProcessPlanCatalog catalog;
    private final ProductionCatalog production;
    private final ProcessLotLookup scanLookup;
    private final GoodPlaceSelections goodPlaceSelections;
    private final ProcessStockPickerController stockPicker;
    record BatchResult(boolean applied,String printStatus,String device) {}
    private record PrintKey(String terminal,String worker,String requestId) {}
    private final java.util.Map<PrintKey,BatchResult> outputReceipts=new java.util.HashMap<>();

    @GetMapping("/production")
    public java.util.List<WorkOrderFixtures.ProductionRow> production(HttpServletRequest request) {
        return fixtures.productionRows(DemoSessionController.requireIdentity(request).terminal().id());
    }
    @GetMapping("/{date}/{sequence}/good-locations")
    public GoodProductLocations.View goodLocations(@PathVariable java.time.LocalDate date, @PathVariable int sequence,
            @RequestParam int slot, HttpServletRequest request) {
        var who = DemoSessionController.requireIdentity(request);
        ProcessLotAccess.require(who, slot);
        var terminal = who.terminal().id();
        return fixtures.goodLocations(terminal, date, sequence, production.terminal(terminal, request).good());
    }
    @PostMapping("/{date}/{sequence}/good-locations")
    public GoodProductLocations.Place selectGoodLocation(@PathVariable LocalDate date, @PathVariable int sequence,
            @RequestParam int slot, @RequestBody GoodProductLocations.Selection choice, HttpServletRequest request) {
        var who = DemoSessionController.requireIdentity(request);
        var view = goodLocations(date, sequence, slot, request);
        return goodPlaceSelections.select(request.getSession(false), who.terminal().id(), date, sequence, slot,
                view, choice, production.goodProducts);
    }
    @GetMapping("/production/roles")
    public java.util.Map<String,List<String>> productionRoles(HttpServletRequest request){
        var who=DemoSessionController.requireIdentity(request);var cfg=production.terminal(who.terminal().id(),request);
        return java.util.Map.of("issue",cfg.issue(),"returns",cfg.returns(),"good",cfg.good(),"bad",cfg.bad());
    }
    @PostMapping("/production")
    public synchronized BatchResult batch(@RequestBody WorkOrderFixtures.Batch cmd,HttpServletRequest request){
        var who=DemoSessionController.requireIdentity(request);
        try {
            if (cmd != null && cmd.selected() != null) {
                for (var row : cmd.selected()) {
                    if (row != null && row.goodPlace() != null) {
                        if (row.goodPlace().slot() == null) throw new IllegalArgumentException("INVALID_COMMAND");
                        ProcessLotAccess.require(who, row.goodPlace().slot());
                    }
                }
            }
            fixtures.processBatch(who.terminal().id(),who.worker().id(),cmd,production.terminal(who.terminal().id(),request),()->settings.lotPolicy(who,request),issue->candidate(issue,request),
                    row -> goodPlaceSelections.confirmed(request.getSession(false),who.terminal().id(),row));
            if(cmd.action()!=WorkOrderFixtures.Action.COMPLETE || !Boolean.TRUE.equals(cmd.autoPrint()))return new BatchResult(true,"NOT_REQUESTED",null);
            var key=new PrintKey(who.terminal().id(),who.worker().id(),cmd.requestId());
            return outputReceipts.computeIfAbsent(key,k->completionReport(who,request,cmd));
        }
        catch(java.util.NoSuchElementException e){throw new ResponseStatusException(HttpStatus.NOT_FOUND,e.getMessage());}
    }

    private ProcessLotLookup.Candidate candidate(WorkOrderFixtures.ScannedIssue issue,HttpServletRequest request){
        if("manual".equals(issue.source())){
            if(issue.slot()==null)throw new IllegalArgumentException("INVALID_COMMAND");
            return stockPicker.selected(issue.date(),issue.sequence(),issue.slot(),issue.warehouse(),issue.location(),issue.lot(),issue.material(),request);
        }
        if(issue.source()!=null&&!"scan".equals(issue.source()))throw new IllegalArgumentException("INVALID_COMMAND");
        var matches=scanLookup.lookup(issue.date(),issue.sequence(),new ProcessLotLookup.Query(issue.lot()),issue.slot(),request).getBody();
        if(matches==null)return null;
        return matches.stream().filter(s->s.material().equals(issue.material())&&s.warehouse().equals(issue.warehouse())
                &&s.location().equals(issue.location())&&s.lot().equals(issue.lot())).findFirst().orElse(null);
    }
    @PostMapping("/{planDate}/{planSequence}/production-materials/manual")
    public java.util.Map<String,Boolean> addManual(@PathVariable LocalDate planDate,@PathVariable int planSequence,
            @RequestBody WorkOrderFixtures.ManualIssue cmd,HttpServletRequest request){
        var who=DemoSessionController.requireIdentity(request);
        fixtures.addManual(who.terminal().id(),who.worker().id(),planDate,planSequence,cmd,settings.lotPolicy(who,request),issue->candidate(issue,request));
        return java.util.Map.of("applied",true);
    }
    private BatchResult completionReport(DemoSessionController.Identity who,HttpServletRequest request,WorkOrderFixtures.Batch cmd) {
        if(!catalog.completionPrintAvailable(request))return new BatchResult(true,"NOT_REQUESTED",null);
        var rows=fixtures.list(who.terminal().id(),null).stream()
                .filter(s->cmd.selected().stream().anyMatch(k->s.planDate().equals(k.date())&&s.planSequence()==k.sequence()))
                .filter(s->s.orderNumber().length()>6 && s.orderNumber().charAt(6)!='S')
                .map(s->new SyntheticOutput.PlanDocumentRow(s.planDate()+"-"+s.planSequence(),
                        s.orderNumber()+"/"+s.orderLine(),s.orderNumber()+"/"+s.orderLine(),s.itemName(),s.plannedQuantity())).toList();
        if(rows.isEmpty())return new BatchResult(true,"NO_REPORT_ROWS",null);
        var device=settings.appliedValues(who,request).outputs().get("document");
        if(device==null || "NONE".equals(device))return new BatchResult(true,"DOCUMENT_PRINTER_NOT_CONFIGURED",null);
        var artifact=output.renderPlan(false,false,rows);
        return new BatchResult(true,artifact.pdf()==null?artifact.contract().status():"SYNTHETIC_PRINTED",device);
    }
    @PostMapping("/{planDate}/{planSequence}/materials/remove")
    public java.util.Map<String,Boolean> withdraw(@PathVariable @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence,@RequestBody WorkOrderFixtures.WithdrawMaterials command,HttpServletRequest request) {
        var who=DemoSessionController.requireIdentity(request);
        try {
            if(!fixtures.withdraw(who.terminal().id(),planDate,planSequence,command))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            return java.util.Map.of("removed",true);
        } catch(IllegalArgumentException e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,e.getMessage());}
        catch(IllegalStateException e){throw new ResponseStatusException(HttpStatus.CONFLICT,e.getMessage());}
    }

    @PostMapping("/remove")
    public java.util.Map<String,Boolean> remove(@RequestBody WorkOrderFixtures.Removal command,HttpServletRequest request) {
        var who=DemoSessionController.requireIdentity(request);
        try { fixtures.remove(who.terminal().id(),who.worker().id(),command);return java.util.Map.of("removed",true); }
        catch(IllegalArgumentException e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,e.getMessage());}
        catch(IllegalStateException e){throw new ResponseStatusException(HttpStatus.CONFLICT,e.getMessage());}
    }

    @PostMapping("/{planDate}/{planSequence}/scan")
    public WorkOrderFixtures.Summary scan(@PathVariable @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence,HttpServletRequest request) {
        var who=DemoSessionController.requireIdentity(request);
        return fixtures.scan(who.terminal().id(),planDate,planSequence).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/{planDate}/{planSequence}/rejections")
    public WorkDefects.View rejections(@PathVariable LocalDate planDate,@PathVariable int planSequence,HttpServletRequest request) {
        var who=DemoSessionController.requireIdentity(request);
        return fixtures.rejections(who.terminal().id(),planDate,planSequence,production.terminal(who.terminal().id(),request));
    }
    @PostMapping("/{planDate}/{planSequence}/rejections")
    public WorkDefects.View saveRejections(@PathVariable LocalDate planDate,@PathVariable int planSequence,@RequestBody WorkDefects.Command cmd,HttpServletRequest request) {
        var who=DemoSessionController.requireIdentity(request);
        return fixtures.setRejections(who.terminal().id(),who.worker().id(),planDate,planSequence,cmd,production.terminal(who.terminal().id(),request));
    }
    @GetMapping("/{planDate}/{planSequence}/production-materials")
    public List<ProductionMaterials.Line> materialRows(@PathVariable LocalDate planDate,@PathVariable int planSequence,HttpServletRequest request){
        var who=DemoSessionController.requireIdentity(request);
        return fixtures.materialRows(who.terminal().id(),planDate,planSequence);
    }
    @PostMapping("/{planDate}/{planSequence}/production-materials")
    public List<ProductionMaterials.Line> editMaterialRows(@PathVariable LocalDate planDate,@PathVariable int planSequence,@RequestBody ProductionMaterials.Command cmd,HttpServletRequest request){
        var who=DemoSessionController.requireIdentity(request);
        if(cmd!=null && cmd.action()==WorkOrderFixtures.Action.RETURN_MATERIAL && !cmd.remove() && production.terminal(who.terminal().id(),request).returns().isEmpty())
            throw new IllegalStateException("RETURN_WAREHOUSE_REQUIRED");
        return fixtures.changeMaterials(who.terminal().id(),who.worker().id(),planDate,planSequence,cmd);
    }
    @org.springframework.web.bind.annotation.ExceptionHandler({IllegalStateException.class,IllegalArgumentException.class,java.util.NoSuchElementException.class})
    public org.springframework.http.ResponseEntity<?> productionError(RuntimeException error) {
        var status=error instanceof IllegalArgumentException?422:error instanceof java.util.NoSuchElementException?404:409;
        return org.springframework.http.ResponseEntity.status(status).body(java.util.Map.of("code",error.getMessage()));
    }
    WorkOrderController(WorkOrderFixtures fixtures, TerminalSettingsDemoController settings, SyntheticOutput output,ProcessPlanCatalog catalog,ProductionCatalog production,ProcessLotLookup scanLookup,ProcessStockPickerController stockPicker,GoodPlaceSelections goodPlaceSelections) {
        this.goodPlaceSelections = goodPlaceSelections;
        this.fixtures = fixtures;
        this.settings = settings;
        this.output = output;
        this.catalog=catalog;
        this.production=production;
        this.scanLookup=scanLookup;this.stockPicker=stockPicker;
    }

    @GetMapping
    List<WorkOrderFixtures.Summary> list(
            @RequestParam(required = false) WorkOrderFixtures.State status, HttpServletRequest request) {
        var terminal = DemoSessionController.requireIdentity(request).terminal();
        return fixtures.list(terminal.id(), status);
    }

    @GetMapping("/{planDate}/{planSequence}")
    WorkOrderFixtures.Detail detail(
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        if (planSequence < 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid production plan sequence");
        }

        return fixtures.find(identity.terminal().id(), planDate, planSequence, settings.lotPolicy(identity, request))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Work order unavailable"));
    }

    @PostMapping(path = "/{planDate}/{planSequence}/actions", consumes = MediaType.APPLICATION_JSON_VALUE)
    WorkOrderFixtures.Detail apply(
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate planDate,
            @PathVariable int planSequence, @RequestBody Command command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        if (planSequence < 1 || command == null || command.action() == null
                || command.expectedRevision() == null || command.expectedRevision() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid work order command");
        }

        try {
            return fixtures.apply(identity.terminal().id(), planDate, planSequence,
                            command.action(), command.actualQuantity(), command.expectedRevision(), identity.worker().id(),
                            command.lotCode(), command.quantity(), command.warehouse(), command.location(),
                            settings.lotPolicy(identity, request))
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Work order unavailable"));
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage());
        } catch (IllegalStateException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage());
        }
    }
}
